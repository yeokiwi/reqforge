"use client";

// The comparison failed for a reason other than "not found" (that is the 404 page): say so inside
// the frame and offer another try, which re-fetches the server render.
import { useRouter } from "next/navigation";
import { startTransition } from "react";
import { t } from "@/copy";
import { secondaryButtonClass } from "@/ui/dialog";

export default function CompareError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  return (
    <section className="mx-auto max-w-7xl" data-testid="compare-error">
      <p role="alert" className="text-base text-slate-800">
        {t("compare.error")}
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
        {t("history.error.retry")}
      </button>
    </section>
  );
}
