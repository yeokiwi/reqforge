import { t } from "@/copy";

// Shown inside the frame while a page loads: the header row, title and byline as placeholders
// in their final places, so the page fills in without moving. No spinner (10 quality bar).
export default function PageLoading() {
  return (
    <div className="mx-auto max-w-5xl" aria-busy="true" data-testid="page-loading">
      <p role="status" className="sr-only">
        {t("pageView.loading")}
      </p>
      <div aria-hidden="true">
        <div className="flex h-8 items-center justify-between">
          <div className="h-4 w-48 rounded bg-slate-100" />
          <div className="h-4 w-72 rounded bg-slate-100" />
        </div>
        <div className="mt-4 h-9 w-2/3 rounded bg-slate-100" />
        <div className="mt-2 h-4 w-80 rounded bg-slate-100" />
        <div className="mt-8 space-y-3">
          <div className="h-4 rounded bg-slate-100" />
          <div className="h-4 w-5/6 rounded bg-slate-100" />
          <div className="h-4 w-4/6 rounded bg-slate-100" />
        </div>
      </div>
    </div>
  );
}
