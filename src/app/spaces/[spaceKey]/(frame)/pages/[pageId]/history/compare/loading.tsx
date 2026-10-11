import { t } from "@/copy";

// Shown inside the frame while a comparison loads: the heading and two empty columns in their
// final places. No spinner.
export default function CompareLoading() {
  return (
    <div className="mx-auto max-w-7xl" aria-busy="true" data-testid="compare-loading">
      <p role="status" className="sr-only">
        {t("compare.loading")}
      </p>
      <div aria-hidden="true">
        <div className="h-4 w-48 rounded bg-slate-100" />
        <div className="mt-4 h-8 w-72 rounded bg-slate-100" />
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="h-24 rounded bg-slate-100" />
          <div className="h-24 rounded bg-slate-100" />
          <div className="h-16 rounded bg-slate-50" />
          <div className="h-16 rounded bg-slate-50" />
        </div>
      </div>
    </div>
  );
}
