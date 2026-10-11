"use client";

// Page History's message line: what the last Restore or Delete said. Both live regions are always
// in the DOM, so a message placed in them is announced; an error is an alert with a Dismiss, a
// confirmation ("v. 3 was deleted.") a status. It takes focus after a Delete, whose row is about
// to disappear with the focused button in it.
// spec: docs/specs/10-ui-reference.md section 23; docs/specs/09-decision-log.md section RD-060
import { t } from "@/copy";
import { secondaryButtonClass } from "@/ui/dialog";
import { useHistory, useNotice } from "./history-context";

export function HistoryNoticeLine() {
  const { store, noticeRef } = useHistory();
  const notice = useNotice();
  return (
    <div ref={noticeRef} tabIndex={-1} className="mt-3 rounded" data-testid="history-notice">
      <div role="alert">
        {notice?.tone === "error" ? (
          <div className="flex items-start gap-3 rounded border border-lozenge-critical bg-lozenge-critical/5 px-3 py-2 text-sm text-slate-900">
            <span className="flex-1">{notice.text}</span>
            <button type="button" className={secondaryButtonClass} onClick={() => store.setNotice(null)}>
              {t("history.dismiss")}
            </button>
          </div>
        ) : null}
      </div>
      <div role="status" className="text-sm text-slate-700">
        {notice?.tone === "status" ? notice.text : null}
      </div>
    </div>
  );
}
