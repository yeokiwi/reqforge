// Page History's view model (10 section 23): one row per version, newest first, the current one
// on top as `CURRENT (v. N)`; the Published column in UTC (src/ui/time.ts) so the server render
// and the client agree; the change note in Comment; and each row's actions for this viewer.
// Pure, so the rows and the permission rules are tested without rendering.
// spec: docs/specs/10-ui-reference.md section 23; docs/specs/09-decision-log.md section RD-060; docs/specs/07-permissions-and-limits.md section 2.4
import { t } from "@/copy";
import type { PageDetail, VersionSummary } from "@/domain/documents";
import { rowActions, type RowActions } from "@/ui/page-history/row-actions";
import { pageHref, pageVersionHref } from "@/ui/page-history/urls";
import { formatDateTime } from "@/ui/time";
import { type Crumb, historyCrumbs } from "./crumbs";

export interface HistoryRow extends RowActions {
  readonly number: number;
  readonly current: boolean;
  /** `CURRENT (v. N)` or `v. N`. */
  readonly label: string;
  /** The page view; a past version opens read-only at `?version=N` (RD-060). */
  readonly href: string;
  /** `Jul 25, 2023 13:08`, UTC. */
  readonly published: string;
  /** ISO-8601, for `<time dateTime>`. */
  readonly publishedAt: string;
  readonly author: string;
  /** The change note; empty when the version has none. */
  readonly comment: string;
}

export interface HistoryModel {
  readonly spaceKey: string;
  readonly pageId: string;
  readonly title: string;
  readonly crumbs: readonly Crumb[];
  readonly rows: readonly HistoryRow[];
  /** Every version number listed, for pruning the compare selection. */
  readonly versions: readonly number[];
  /** Ticked when the screen opens: the current version (the video's `●`). */
  readonly initialSelected: readonly number[];
}

/**
 * The rows, current first, then newest to oldest. The `current` flag comes from the version list
 * itself, never from the page, so a publish between the two reads cannot mislabel a row.
 */
// spec: docs/specs/10-ui-reference.md section 23 (the table, the CURRENT row, Comment, Restore and Delete)
export function buildHistoryRows(
  spaceKey: string,
  pageId: string,
  versions: readonly VersionSummary[],
  permissions: PageDetail["permissions"],
): HistoryRow[] {
  const ordered = [...versions].sort((p, q) => Number(q.current) - Number(p.current) || q.number - p.number);
  return ordered.map((v) => ({
    number: v.number,
    current: v.current,
    label: v.current ? t("history.current", { n: v.number }) : t("history.version", { n: v.number }),
    href: v.current ? pageHref(spaceKey, pageId) : pageVersionHref(spaceKey, pageId, v.number),
    published: formatDateTime(v.createdAt),
    publishedAt: v.createdAt,
    author: v.author.name,
    comment: v.message ?? "",
    ...rowActions(v, permissions),
  }));
}

export interface HistoryScreen {
  readonly space: { readonly key: string; readonly name: string };
  readonly page: PageDetail;
  readonly versions: readonly VersionSummary[];
}

// spec: docs/specs/10-ui-reference.md section 23; RD-060
export function buildHistoryModel(screen: HistoryScreen): HistoryModel {
  const spaceKey = screen.space.key;
  const rows = buildHistoryRows(spaceKey, screen.page.id, screen.versions, screen.page.permissions);
  return {
    spaceKey,
    pageId: screen.page.id,
    title: screen.page.title,
    crumbs: historyCrumbs(spaceKey, screen.page),
    rows,
    versions: rows.map((r) => r.number),
    initialSelected: rows.filter((r) => r.current).map((r) => r.number),
  };
}
