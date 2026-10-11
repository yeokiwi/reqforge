// `Pages / <ancestors> / <title>` above Page History and Compare; the title links back to the page
// view. Drawn like the page view's breadcrumb (10 section 4.1). No hooks: renders on the server.
// spec: docs/specs/10-ui-reference.md sections 4.1 and 23; docs/specs/09-decision-log.md section RD-078
import Link from "next/link";
import { t } from "@/copy";
import type { Crumb } from "../_lib/crumbs";

const crumbLink = "text-slate-600 no-underline hover:text-slate-900 hover:underline";

export function HistoryBreadcrumb({ crumbs }: { readonly crumbs: readonly Crumb[] }) {
  return (
    <nav aria-label={t("history.breadcrumb")} className="min-w-0">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {crumbs.map((crumb, index) => (
          <li key={`${index}:${crumb.href}`} className="flex min-w-0 items-center gap-1">
            {index > 0 ? (
              <span aria-hidden="true" className="text-slate-400">
                /
              </span>
            ) : null}
            <Link href={crumb.href} className={`${crumbLink} truncate`}>
              {crumb.label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
