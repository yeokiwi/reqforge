// The page view's breadcrumb (10 section 4.1, RD-078): `Pages / <ancestors> / <title>`. `Pages`
// links to the space overview, each ancestor to its page view, and the trail ends with the page
// itself as plain text (aria-current), not a link. No hooks and no browser APIs, so it renders in
// server and client components alike.
// spec: docs/specs/10-ui-reference.md section 4.1; docs/specs/09-decision-log.md section RD-078
import Link from "next/link";
import { t } from "@/copy";
import { pageHref, spaceHref } from "./urls";

export interface Crumb {
  readonly label: string;
  /** null for the last crumb: the page itself is not a link (RD-078). */
  readonly href: string | null;
}

/**
 * The crumbs of a page in view mode: `Pages`, the ancestors root first, then the page itself.
 * `ancestors` excludes the page (PageDetail.ancestors).
 */
// spec: docs/specs/10-ui-reference.md section 4.1 (Breadcrumb `Pages / <ancestors> / <title>`); RD-078
export function pageCrumbs(
  spaceKey: string,
  ancestors: readonly { readonly id: string; readonly title: string }[],
  title: string,
): Crumb[] {
  return [
    { label: t("sidebar.pages"), href: spaceHref(spaceKey) },
    ...ancestors.map((a) => ({ label: a.title, href: pageHref(spaceKey, a.id) })),
    { label: title, href: null },
  ];
}

const crumbLink = "text-slate-600 no-underline hover:text-slate-900 hover:underline";

export function Breadcrumb({ crumbs }: { readonly crumbs: readonly Crumb[] }) {
  return (
    <nav aria-label={t("pageView.breadcrumb")} className="min-w-0">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {crumbs.map((crumb, index) => (
          <li key={`${index}:${crumb.href ?? ""}`} className="flex min-w-0 items-center gap-1">
            {index > 0 ? (
              <span aria-hidden="true" className="text-slate-400">
                /
              </span>
            ) : null}
            {crumb.href === null ? (
              <span aria-current="page" className="truncate text-slate-900">
                {crumb.label}
              </span>
            ) : (
              <Link href={crumb.href} className={crumbLink}>
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
