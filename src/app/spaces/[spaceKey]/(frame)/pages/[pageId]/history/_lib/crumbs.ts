// The trail above Page History and Compare: `Pages / <ancestors> / <title>`, the view-mode
// breadcrumb of 10 section 4.1, except that the page's own crumb is a link back to the page view
// here — the page is where these screens came from, not where the reader is.
// spec: docs/specs/10-ui-reference.md sections 4.1 and 23; docs/specs/09-decision-log.md section RD-078
import { t } from "@/copy";
import { pageHref, spaceHref } from "@/ui/page-history/urls";

export interface Crumb {
  readonly label: string;
  readonly href: string;
}

/** `Pages` (the space overview), the ancestors root first, then the page itself — all links. */
// spec: docs/specs/10-ui-reference.md section 4.1 (Breadcrumb `Pages / <ancestors> / <title>`); RD-078
export function historyCrumbs(
  spaceKey: string,
  page: { readonly id: string; readonly title: string; readonly ancestors: readonly { readonly id: string; readonly title: string }[] },
): Crumb[] {
  return [
    { label: t("sidebar.pages"), href: spaceHref(spaceKey) },
    ...page.ancestors.map((a) => ({ label: a.title, href: pageHref(spaceKey, a.id) })),
    { label: page.title, href: pageHref(spaceKey, page.id) },
  ];
}
