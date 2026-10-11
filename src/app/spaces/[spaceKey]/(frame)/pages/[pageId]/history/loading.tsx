import { t } from "@/copy";

// Shown inside the frame while Page History loads: the heading, intro, button and a few rows as
// placeholders in their final places, so the screen fills in without moving. No spinner.
export default function PageHistoryLoading() {
  return (
    <div className="mx-auto max-w-5xl" aria-busy="true" data-testid="history-loading">
      <p role="status" className="sr-only">
        {t("history.loading")}
      </p>
      <div aria-hidden="true">
        <div className="h-4 w-48 rounded bg-slate-100" />
        <div className="mt-4 h-8 w-56 rounded bg-slate-100" />
        <div className="mt-3 h-4 w-3/4 rounded bg-slate-100" />
        <div className="mt-4 h-8 w-52 rounded bg-slate-100" />
        <div className="mt-6 space-y-2">
          <div className="h-9 rounded bg-slate-100" />
          <div className="h-8 rounded bg-slate-50" />
          <div className="h-8 rounded bg-slate-50" />
          <div className="h-8 rounded bg-slate-50" />
        </div>
      </div>
    </div>
  );
}
