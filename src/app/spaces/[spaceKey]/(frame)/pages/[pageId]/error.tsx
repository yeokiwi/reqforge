"use client";

// The page view failed for a reason other than "not found" (that is the 404 page): say so
// inside the frame and offer another try, which re-fetches the server render. The error itself
// is not shown; it is for logs.
import { useRouter } from "next/navigation";
import { startTransition } from "react";
import { t } from "@/copy";
import { secondaryButtonClass } from "@/ui/dialog";

export default function PageViewError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  return (
    <section className="mx-auto max-w-5xl" data-testid="page-error">
      <p role="alert" className="text-base text-slate-800">
        {t("pageView.error")}
      </p>
      <button
        type="button"
        className={`${secondaryButtonClass} mt-3 border border-slate-300`}
        onClick={() =>
          startTransition(() => {
            router.refresh();
            reset();
          })
        }
      >
        {t("pageView.error.retry")}
      </button>
    </section>
  );
}
