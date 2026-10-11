// The compare screen's view model (RD-060): both versions side by side, read-only, one aligned row
// per top-level block as diffDocuments classified it — `same`, `changed` (both sides), `removed`
// (left only) or `added` (right only). Adds what the screen says about the whole comparison: the
// counts, whether the content is identical, whether the titles differ, and whether RD-066's work
// cap made the alignment approximate. Pure.
// spec: docs/specs/09-decision-log.md sections RD-060 (Compare selected versions) and RD-066 (work cap); 10 section 11
import { t } from "@/copy";
import type { BlockDiff, BlockDiffStatus, PageDetail, VersionDetail } from "@/domain/documents";
import { topLevelBlocks } from "@/domain/documents";
import { historyHref, pageHref, pageVersionHref } from "@/ui/page-history/urls";
import { formatDateTime } from "@/ui/time";
import { type Crumb, historyCrumbs } from "./crumbs";

export interface CompareSide {
  readonly number: number;
  readonly current: boolean;
  /** `CURRENT (v. N)` or `v. N`, as Page History labels it. */
  readonly label: string;
  /** The version's read-only view (the page view for the current version). */
  readonly href: string;
  readonly title: string;
  readonly published: string;
  readonly publishedAt: string;
  readonly author: string;
  readonly comment: string | null;
  /** The version has no top-level blocks at all. */
  readonly empty: boolean;
}

export interface CompareRow {
  /** Stable React key. */
  readonly key: string;
  readonly status: BlockDiffStatus;
  /** The left version's block; null for an added row. */
  readonly left: unknown;
  readonly leftIndex: number | null;
  /** The right version's block; null for a removed row. */
  readonly right: unknown;
  readonly rightIndex: number | null;
}

export interface CompareCounts {
  readonly added: number;
  readonly removed: number;
  readonly changed: number;
  readonly same: number;
}

export interface CompareModel {
  readonly spaceKey: string;
  readonly pageId: string;
  readonly crumbs: readonly Crumb[];
  readonly historyHref: string;
  readonly left: CompareSide;
  readonly right: CompareSide;
  /** The two versions' titles differ: both headers flag it. */
  readonly titleChanged: boolean;
  readonly rows: readonly CompareRow[];
  readonly counts: CompareCounts;
  /** No block was added, removed or changed. */
  readonly identical: boolean;
  /** RD-066: the alignment ran out of budget, so some equal blocks may show as different. */
  readonly approximate: boolean;
}

export interface CompareInput {
  readonly space: { readonly key: string };
  readonly page: PageDetail;
  readonly left: VersionDetail;
  readonly right: VersionDetail;
  readonly blocks: readonly BlockDiff[];
  readonly approximate: boolean;
}

function sideOf(spaceKey: string, pageId: string, v: VersionDetail): CompareSide {
  return {
    number: v.number,
    current: v.current,
    label: v.current ? t("history.current", { n: v.number }) : t("history.version", { n: v.number }),
    href: v.current ? pageHref(spaceKey, pageId) : pageVersionHref(spaceKey, pageId, v.number),
    title: v.title,
    published: formatDateTime(v.createdAt),
    publishedAt: v.createdAt,
    author: v.author.name,
    comment: v.message,
    empty: topLevelBlocks(v.content).length === 0,
  };
}

/** One row per BlockDiff, in order; a missing side is null. */
// spec: docs/specs/09-decision-log.md section RD-060 (changed top-level blocks highlighted: added, removed, changed)
export function compareRows(blocks: readonly BlockDiff[]): CompareRow[] {
  return blocks.map((block) => {
    const leftIndex = block.status === "added" ? null : block.leftIndex;
    const rightIndex = block.status === "removed" ? null : block.rightIndex;
    return {
      key: `${leftIndex ?? "-"}:${rightIndex ?? "-"}`,
      status: block.status,
      left: block.status === "added" ? null : block.left,
      leftIndex,
      right: block.status === "removed" ? null : block.right,
      rightIndex,
    };
  });
}

export function countRows(rows: readonly CompareRow[]): CompareCounts {
  const counts = { added: 0, removed: 0, changed: 0, same: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

// spec: docs/specs/09-decision-log.md sections RD-060, RD-066
export function buildCompareModel(input: CompareInput): CompareModel {
  const spaceKey = input.space.key;
  const pageId = input.page.id;
  const rows = compareRows(input.blocks);
  const counts = countRows(rows);
  return {
    spaceKey,
    pageId,
    crumbs: historyCrumbs(spaceKey, input.page),
    historyHref: historyHref(spaceKey, pageId),
    left: sideOf(spaceKey, pageId, input.left),
    right: sideOf(spaceKey, pageId, input.right),
    titleChanged: input.left.title !== input.right.title,
    rows,
    counts,
    identical: counts.added + counts.removed + counts.changed === 0,
    approximate: input.approximate,
  };
}

/** A one-block document: how each cell renders its block with <DocumentView> (RD-069). */
export function blockDoc(block: unknown): { type: "doc"; content: unknown[] } {
  return { type: "doc", content: [block] };
}

/**
 * The heading-anchor prefix of one cell. Every cell is its own DocumentView, so two cells holding
 * the same heading would otherwise produce the same id (RD-069: one prefix per view).
 */
// spec: docs/specs/09-decision-log.md section RD-069 (heading anchors; the prefix is per view)
export function cellIdPrefix(side: "a" | "b", index: number): string {
  return `rf-h-${side}${index}-`;
}

/**
 * Whether the comparison reports that RD-066's work cap cut the alignment short. The use case's
 * VersionComparison does not carry this yet (handed off to the server unit as `approximate:
 * boolean`); until it does, this reads false and the notice never shows.
 */
// spec: docs/specs/09-decision-log.md section RD-066 (past the cap some equal blocks may be shown as changed, removed or added)
export function readApproximate(comparison: object): boolean {
  return "approximate" in comparison && comparison.approximate === true;
}
