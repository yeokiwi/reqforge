import type { Edge } from '@/domain/baselines';
import { collectImageSources, hasImages, rewriteImageSources } from '@/domain/baselines';
import { fetchImage, type FetchResult } from '@/server/images/fetch';
import { storedImageUrl, storeImage } from '@/server/images/store';
import type { JobHandler } from '../runner';

export type FreezePayload = {
  spaceKey: string;
  baselineId: string;
  /** Decided when Freeze was pressed, not gradually as the job runs. */
  memberKeys: string[];
  includedExternal: boolean;
  batchSize: number;
  /** Who pressed Freeze — recorded on the baseline as `frozenById`. */
  actorId: string;
};

/** One batch: the live rows behind a window of member keys, plus their edges. */
export type FreezePage = {
  rows: Array<{
    id: string;
    key: string;
    upperKey: string;
    uid: string;
    title: string;
    bodyHtml: string;
    bodySearch: string;
    anchorPath: string;
    typeId: string | null;
    originVersionId: string | null;
  }>;
  internal: Edge[];
  dangling: Edge[];
  total: number;
};

export type FreezeWriter = {
  writeBatch: (input: {
    baselineId: string;
    rows: Array<FreezePage['rows'][number] & { frozenBodyHtml: string }>;
    includedExternal: boolean;
  }) => Promise<number>;
  writeEdges: (baselineId: string, edges: readonly Edge[]) => Promise<number>;
  writeDangling: (baselineId: string, edges: readonly Edge[]) => Promise<void>;
  markFrozen: (baselineId: string, actorId: string) => Promise<void>;
  clear: (baselineId: string) => Promise<number>;
};

/** Injected by `register.ts`, so the handler itself imports no database code. */
let writer: FreezeWriter | null = null;

export function setFreezeWriter(next: FreezeWriter): void {
  writer = next;
}

/**
 * How an image is fetched. Swappable so a test can freeze a body with an image in it
 * without reaching the network, and so the acceptance check of PLAN.md — "a frozen body's
 * images resolve after the source image is replaced" — can replace what a URL serves.
 */
export type ImageFetcher = (url: string) => Promise<FetchResult>;

let imageFetcher: ImageFetcher = (url) => fetchImage(url);

export function setImageFetcher(next: ImageFetcher): void {
  imageFetcher = next;
}

export function resetImageFetcher(): void {
  imageFetcher = (url) => fetchImage(url);
}

/**
 * The freeze.
 * spec: 05-baselines-and-diff.md §3.2 — one pass over the member set, batched at 500
 * because Requirement Yogi's own docs name baseline creation as the operation that
 * exhausts the heap (research §6.7).
 *
 * Invariant B1 holds throughout: a cancelled or failed freeze leaves the baseline DRAFT
 * and owning no rows, because the last thing the job does is mark it FROZEN.
 */
export const freezeHandler: JobHandler<FreezePayload, FreezePage> = async (payload, context) => {
  if (!writer) throw new Error('No freeze writer is registered.');
  const write = writer;

  // A retry, or a refreeze, starts from an empty baseline rather than duplicating rows.
  await write.clear(payload.baselineId);

  /** Every materialised image of this run, so one URL is fetched once (`RD-012`). */
  const materialised = new Map<string, string>();
  const internal: Edge[] = [];
  const dangling: Edge[] = [];
  let done = 0;
  let offset = 0;

  for (;;) {
    if (await context.cancelled()) {
      await write.clear(payload.baselineId);
      return { cancelled: true };
    }

    const page = await context.fetchPage(offset);
    if (page.rows.length === 0) break;

    const rows = [];
    for (const row of page.rows) {
      rows.push({ ...row, frozenBodyHtml: await materialise(row.bodyHtml, payload.spaceKey, materialised) });
    }

    await write.writeBatch({ baselineId: payload.baselineId, rows, includedExternal: payload.includedExternal });

    internal.push(...page.internal);
    dangling.push(...page.dangling);
    done += page.rows.length;
    offset += page.rows.length;

    const percent = page.total > 0 ? Math.min(Math.round((done / page.total) * 90), 90) : 90;
    await context.progress(percent, `Frozen ${done} of ${page.total}.`);

    if (done >= page.total) break;
  }

  // Edges last: an edge whose two ends landed in different batches is still internal.
  await write.writeEdges(payload.baselineId, internal);
  await write.writeDangling(payload.baselineId, dangling);
  await write.markFrozen(payload.baselineId, payload.actorId);

  await context.progress(
    100,
    `Frozen ${done} requirement${done === 1 ? '' : 's'}` +
      (dangling.length > 0 ? `; ${dangling.length} dependencies point outside the baseline.` : '.'),
  );

  return {};
};

/**
 * spec 05 §3.2 step 7, `RD-012` — every image in a frozen body is copied into
 * content-addressed storage and the body rewritten to the immutable URL. An image that
 * cannot be materialised **fails the freeze**, naming it: a snapshot whose pictures can
 * change under it is worse than no snapshot (`RD-043`).
 */
async function materialise(
  bodyHtml: string,
  spaceKey: string,
  materialised: Map<string, string>,
): Promise<string> {
  if (!hasImages(bodyHtml)) return bodyHtml;

  for (const source of collectImageSources(bodyHtml)) {
    // Already stored, or already served from our own storage: nothing to fetch.
    if (materialised.has(source)) continue;
    if (source.startsWith(`/s/${spaceKey}/images/`)) {
      materialised.set(source, source);
      continue;
    }

    const fetched = await imageFetcher(source);
    if (!fetched.ok) {
      throw new Error(`This baseline cannot be frozen: ${fetched.reason}`);
    }

    const stored = await storeImage(fetched.bytes, fetched.mediaType);
    materialised.set(source, storedImageUrl(spaceKey, stored.name));
  }

  return rewriteImageSources(bodyHtml, materialised);
}
