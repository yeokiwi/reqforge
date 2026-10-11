"use client";

// `[Compare selected versions]` (10 section 23): available only while exactly two versions are
// ticked, and then it opens /history/compare?a=<older>&b=<newer> (10 section 11). Otherwise it is
// aria-disabled rather than disabled, so it stays focusable and its description says why — "Select
// exactly two versions to compare. 3 selected." — to keyboard and screen-reader users alike; the
// same text is its tooltip.
// spec: docs/specs/10-ui-reference.md sections 11 and 23; docs/specs/09-decision-log.md section RD-060
import { useRouter } from "next/navigation";
import { useId } from "react";
import { t } from "@/copy";
import { primaryButtonClass } from "@/ui/dialog";
import { useHistory, useSelected } from "./history-context";
import { comparePair } from "./selection";
import { compareHref } from "./urls";

export function CompareButton() {
  const { spaceKey, pageId } = useHistory();
  const selected = useSelected();
  const router = useRouter();
  const hintId = useId();
  const pair = comparePair(selected);
  const hint =
    pair === null ? t("history.compare.hint", { n: selected.length }) : t("history.compare.ready", { a: pair[0], b: pair[1] });

  return (
    <div className="mt-4">
      <button
        type="button"
        className={`${primaryButtonClass} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
        aria-disabled={pair === null ? "true" : undefined}
        aria-describedby={hintId}
        title={pair === null ? hint : undefined}
        onClick={() => {
          if (pair === null) return;
          router.push(compareHref(spaceKey, pageId, pair[0], pair[1]));
        }}
        data-testid="history-compare"
      >
        {t("history.compare")}
      </button>
      <span id={hintId} className="sr-only">
        {hint}
      </span>
    </div>
  );
}
