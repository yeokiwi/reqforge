// Page History's table (10 section 23): (checkbox) · Version · Published · Changed By · Comment ·
// Actions, in the video's order. Rendered on the server; only the box and the actions of each row
// are client islands (src/ui/page-history), so a long history ships little JavaScript and ticking
// a box re-renders one box.
// spec: docs/specs/10-ui-reference.md section 23; docs/specs/09-decision-log.md section RD-060
import Link from "next/link";
import { t } from "@/copy";
import { VersionActions } from "@/ui/page-history/version-actions";
import { VersionCheckbox } from "@/ui/page-history/version-checkbox";
import type { HistoryRow } from "../_lib/history-model";

const th = "px-3 py-2 text-left text-sm font-semibold text-slate-700";
const td = "px-3 py-2 align-top text-sm text-slate-900";

export function HistoryTable({ title, rows }: { readonly title: string; readonly rows: readonly HistoryRow[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse" data-testid="history-table">
        <caption className="sr-only">{t("history.table", { title })}</caption>
        <thead className="bg-table-header">
          <tr>
            <th scope="col" className={`${th} w-10`}>
              <span className="sr-only">{t("history.col.select")}</span>
            </th>
            <th scope="col" className={th}>
              {t("history.col.version")}
            </th>
            <th scope="col" className={th}>
              {t("history.col.published")}
            </th>
            <th scope="col" className={th}>
              {t("history.col.changedBy")}
            </th>
            <th scope="col" className={th}>
              {t("history.col.comment")}
            </th>
            <th scope="col" className={th}>
              {t("history.col.actions")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.number} className="border-b border-slate-200" data-testid={`history-row-${row.number}`}>
              <td className={td}>
                <VersionCheckbox version={row.number} />
              </td>
              <th scope="row" className={`${td} whitespace-nowrap text-left font-normal`}>
                <Link href={row.href} className={row.current ? "font-semibold text-link hover:underline" : "text-link hover:underline"}>
                  {row.label}
                </Link>
              </th>
              <td className={`${td} whitespace-nowrap`}>
                <time dateTime={row.publishedAt}>{row.published}</time>
              </td>
              <td className={td}>{row.author}</td>
              <td className={`${td} max-w-md break-words`}>{row.comment}</td>
              <td className={td}>
                {row.current ? null : <VersionActions version={row.number} restore={row.restore} delete={row.delete} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
