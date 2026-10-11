// Compare selected versions (RD-060): two equal columns, read-only, a header per version (label,
// title, published, author, change note), then one aligned row per top-level block — removed rows
// are empty on the right, added rows empty on the left. Every block renders with <DocumentView> on
// a one-block document. Status is a coloured edge AND a badge with a glyph and a word; unchanged
// rows are left plain. All rows are shown, in order. The whole thing is one page, so the columns
// scroll together; below `md` each row stacks its left cell over its right one, each labelled.
// No hooks: renders on the server.
// spec: docs/specs/09-decision-log.md sections RD-060, RD-066, RD-069; docs/specs/10-ui-reference.md sections 1.1 and 11
import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/copy";
import type { BlockDiffStatus } from "@/domain/documents";
import { DocumentView } from "@/editor/render/document-view";
import { AddedGlyph, ChangedGlyph, RemovedGlyph } from "@/ui/page-history/icons";
import { blockDoc, cellIdPrefix, type CompareModel, type CompareSide } from "../_lib/compare-model";
import { HistoryBreadcrumb } from "./history-breadcrumb";

type Shown = Exclude<BlockDiffStatus, "same">;

const BADGE: Record<Shown, { readonly className: string; readonly glyph: ReactNode; readonly label: () => string }> = {
  added: { className: "bg-badge-original text-white", glyph: <AddedGlyph />, label: () => t("compare.status.added") },
  removed: { className: "bg-lozenge-critical text-white", glyph: <RemovedGlyph />, label: () => t("compare.status.removed") },
  changed: { className: "bg-lozenge-medium text-slate-900", glyph: <ChangedGlyph />, label: () => t("compare.status.changed") },
};

const CELL_TONE: Record<BlockDiffStatus, string> = {
  same: "border-transparent",
  added: "border-badge-original bg-badge-original/10",
  removed: "border-lozenge-critical bg-lozenge-critical/10",
  changed: "border-lozenge-medium bg-lozenge-medium/10",
};

const ROW = "grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2";
const BADGE_SHAPE = "inline-flex items-center gap-1 rounded-sm px-1.5 py-px text-[11px] font-bold uppercase leading-4";

function StatusBadge({ status }: { readonly status: Shown }) {
  const badge = BADGE[status];
  return (
    <span className={`${BADGE_SHAPE} ${badge.className}`} data-testid="compare-badge">
      {badge.glyph}
      {badge.label()}
    </span>
  );
}

function SideHeader({ side, titleChanged }: { readonly side: CompareSide; readonly titleChanged: boolean }) {
  return (
    <div role="columnheader" className="min-w-0 border-b-2 border-slate-300 pb-3 text-left font-normal" data-testid="compare-side">
      <Link href={side.href} className="text-base font-semibold text-link hover:underline">
        {side.label}
      </Link>
      <p className="mt-1 break-words text-lg font-semibold text-slate-900">
        <span>{side.title}</span>
        {titleChanged ? (
          <span className="ml-2 align-middle">
            <span className={`${BADGE_SHAPE} ${BADGE.changed.className}`} data-testid="compare-title-changed">
              <ChangedGlyph />
              {t("compare.titleChanged")}
            </span>
          </span>
        ) : null}
      </p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-sm text-slate-700">
        <dt className="after:content-[':']">{t("history.col.published")}</dt>
        <dd>
          <time dateTime={side.publishedAt}>{side.published}</time>
        </dd>
        <dt className="after:content-[':']">{t("history.col.changedBy")}</dt>
        <dd className="break-words">{side.author}</dd>
        {side.comment !== null ? (
          <>
            <dt className="after:content-[':']">{t("history.col.comment")}</dt>
            <dd className="break-words">{side.comment}</dd>
          </>
        ) : null}
      </dl>
      {side.empty ? <p className="mt-1 text-sm italic text-slate-500">{t("compare.empty")}</p> : null}
    </div>
  );
}

interface CellProps {
  readonly side: "a" | "b";
  /** The version this column shows. */
  readonly version: CompareSide;
  readonly block: unknown;
  readonly index: number | null;
  readonly status: BlockDiffStatus;
}

function BlockCell({ side, version, block, index, status }: CellProps) {
  if (index === null) {
    // The empty side of an added or removed block: blank in two columns, labelled when stacked.
    return (
      <div role="cell" className="min-w-0 rounded bg-slate-50 px-3 py-2" data-testid={`compare-cell-${side}`} data-empty="">
        <span className="text-xs italic text-slate-500 md:sr-only">{t("compare.missing", { n: version.number })}</span>
      </div>
    );
  }
  return (
    <div role="cell" className={`min-w-0 overflow-x-auto border-l-4 px-3 py-2 ${CELL_TONE[status]}`} data-testid={`compare-cell-${side}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500 md:hidden">{version.label}</span>
        {status === "same" ? <span className="sr-only">{t("compare.status.same")}</span> : <StatusBadge status={status} />}
      </div>
      <DocumentView content={blockDoc(block)} idPrefix={cellIdPrefix(side, index)} />
    </div>
  );
}

export function CompareView({ model }: { readonly model: CompareModel }) {
  const { left, right, counts } = model;
  return (
    <article className="mx-auto max-w-7xl" data-testid="compare-view">
      <HistoryBreadcrumb crumbs={model.crumbs} />
      <h1 className="mt-4 text-2xl font-semibold text-slate-900">{t("compare.title", { a: left.number, b: right.number })}</h1>
      <p className="mt-1 text-sm">
        <Link href={model.historyHref} className="text-link hover:underline">
          {t("compare.back")}
        </Link>
      </p>

      {model.identical ? (
        <p className="mt-4 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900" data-testid="compare-identical">
          {t("compare.identical", { a: left.number, b: right.number })}
        </p>
      ) : (
        <p className="mt-4 text-sm text-slate-700" data-testid="compare-summary">
          {t("compare.summary", { added: counts.added, removed: counts.removed, changed: counts.changed })}
        </p>
      )}
      {model.approximate ? (
        <p
          role="note"
          className="mt-2 rounded border border-lozenge-medium bg-lozenge-medium/10 px-3 py-2 text-sm text-slate-900"
          data-testid="compare-approximate"
        >
          {t("compare.approximate")}
        </p>
      ) : null}

      <div role="table" aria-label={t("compare.table", { a: left.number, b: right.number })} className="mt-4" data-testid="compare-table">
        <div role="rowgroup">
          <div role="row" className={ROW}>
            <SideHeader side={left} titleChanged={model.titleChanged} />
            <SideHeader side={right} titleChanged={model.titleChanged} />
          </div>
        </div>
        <div role="rowgroup">
          {model.rows.map((row) => (
            <div role="row" key={row.key} className={`${ROW} border-b border-slate-100 py-1`} data-status={row.status} data-testid="compare-row">
              <BlockCell side="a" version={left} block={row.left} index={row.leftIndex} status={row.status} />
              <BlockCell side="b" version={right} block={row.right} index={row.rightIndex} status={row.status} />
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}
