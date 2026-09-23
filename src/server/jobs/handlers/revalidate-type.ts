import type { Diagnostic } from '@/domain/indexer';
import { validateRequirement, type Rule } from '@/domain/validation';
import type { JobHandler } from '../runner';

export type RevalidateTypePayload = {
  spaceKey: string;
  typeId: string;
  pageSize: number;
  /** Who changed the type — the actor of any `validation.failed` event (spec 08 §7). */
  actorId?: string;
};

/** One page of a type's requirements, with everything validating them needs. */
export type RevalidatePage = {
  rules: Rule[];
  total: number;
  subjects: Array<{
    id: string;
    key: string;
    anchorPath: string;
    properties: Array<{ name: string; searchName: string; value: string }>;
    outbound: string[];
    inbound: string[];
  }>;
};

export type RevalidateWriter = (
  rows: Array<{ requirementId: string; typeId: string; status: 'TRUE' | 'FALSE' | 'WARNING'; diagnostics: Diagnostic[] }>,
  context: { actorId: string | null },
) => Promise<void>;

/** Supplied by `register.ts`, which is the only place that knows about the database. */
let writeResults: RevalidateWriter = async () => {};

export function setRevalidateWriter(writer: RevalidateWriter): void {
  writeResults = writer;
}

/**
 * Revalidates every requirement of one type.
 * spec: 06-requirement-types.md §2.2 trigger 2 — "editing a type enqueues a job
 * revalidating every requirement of that type in the space, with progress. This is the
 * one RY cannot do" (`RD-016`), because RY's validation ran inside a page render.
 *
 * The page source loads a page's properties and edges in batched queries, so validating
 * one requirement still issues zero queries of its own (spec 06 §2.3).
 */
export const revalidateTypeHandler: JobHandler<RevalidateTypePayload, RevalidatePage> = async (
  payload,
  context,
) => {
  let offset = 0;
  let done = 0;

  for (;;) {
    if (await context.cancelled()) return { cancelled: true };

    const page = await context.fetchPage(offset);
    if (page.subjects.length === 0) break;

    await writeResults(
      page.subjects.map((subject) => {
        const outcome = validateRequirement(
          {
            key: subject.key,
            anchorPath: subject.anchorPath,
            properties: subject.properties,
            outbound: subject.outbound,
            inbound: subject.inbound,
            // No document in hand here, so no quick fixes: the job decides the status,
            // the editor decides the repair (`RD-042`).
            placement: null,
          },
          page.rules,
        );
        return {
          requirementId: subject.id,
          typeId: payload.typeId,
          status: outcome.status,
          diagnostics: outcome.diagnostics,
        };
      }),
      { actorId: payload.actorId ?? null },
    );

    done += page.subjects.length;
    offset += page.subjects.length;

    const percent = page.total > 0 ? Math.min(Math.round((done / page.total) * 100), 100) : 100;
    await context.progress(percent, `Validated ${done} of ${page.total}.`);

    if (done >= page.total) break;
  }

  await context.progress(100, `Validated ${done} requirement${done === 1 ? '' : 's'}.`);
  return {};
};
