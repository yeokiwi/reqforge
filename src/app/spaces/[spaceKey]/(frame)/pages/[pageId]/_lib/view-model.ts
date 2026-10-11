// Every decision the page view makes, as data (10 section 4): what the header shows for this
// viewer and this version, the byline's times, and whether the version banner or the draft
// notice appear. The route only renders what this returns; tests check the rules here.
// spec: docs/specs/10-ui-reference.md sections 4.1 and 11; docs/specs/09-decision-log.md sections RD-055, RD-059, RD-060, RD-078
import type { PageDetail, PageSummary } from "@/domain/documents";
import { type Crumb, pageCrumbs } from "@/ui/page-view/breadcrumb";
import type { BylineView } from "@/ui/page-view/byline";
import { pageEditHref, pageHistoryHref, pageHref } from "@/ui/page-view/urls";
import { formatDateTime, formatRelative } from "@/ui/time";
import type { PageScreen } from "./load-page";

export interface PageViewModel {
  readonly space: { readonly key: string; readonly name: string };
  readonly page: PageDetail;
  readonly pages: readonly PageSummary[];
  /** The shown version's title: the h1 and the window title. */
  readonly title: string;
  /** `Pages / <ancestors> / <current title>`; the last crumb is not a link (RD-078). */
  readonly crumbs: readonly Crumb[];
  readonly byline: BylineView;
  /** The shown version's content, for DocumentView. */
  readonly content: unknown;
  /** The version number when a past version is shown (banner, read-only); null on the current one. */
  readonly pastVersion: number | null;
  /** `✎ Edit` (and the `E` key): the viewer can edit and is on the current version. */
  readonly canEditHere: boolean;
  /** The viewer's own unpublished draft, offered while looking at the current version. */
  readonly showDraftNotice: boolean;
  readonly hrefs: { readonly view: string; readonly edit: string; readonly history: string };
}

/**
 * The page view for one viewer at one moment. `now` is the server's clock at render: the
 * byline's relative time is computed once, on the server, and never again on the client.
 */
// spec: docs/specs/10-ui-reference.md section 4.1 (header; `last modified` relative, absolute on hover); RD-060 (past versions are read-only); RD-055
export function buildPageViewModel(screen: PageScreen, now: Date): PageViewModel {
  const { space, page, version, pages } = screen;
  const pastVersion = version.current ? null : version.number;
  const onCurrent = pastVersion === null;
  return {
    space,
    page,
    pages,
    title: version.title,
    crumbs: pageCrumbs(space.key, page.ancestors, page.title),
    byline: {
      author: page.createdBy.name,
      modifiedAt: version.createdAt,
      relative: formatRelative(version.createdAt, now),
      absolute: formatDateTime(version.createdAt),
    },
    content: version.content,
    pastVersion,
    canEditHere: onCurrent && page.permissions.canEdit,
    showDraftNotice: onCurrent && page.hasDraft && page.permissions.canEdit,
    hrefs: {
      view: pageHref(space.key, page.id),
      edit: pageEditHref(space.key, page.id),
      history: pageHistoryHref(space.key, page.id),
    },
  };
}
