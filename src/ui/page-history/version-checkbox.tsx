"use client";

// One row's box in Page History's first column (10 section 23). Named by its version, so a
// screen-reader user hears which version they are ticking.
// spec: docs/specs/10-ui-reference.md section 23 (`Compare selected versions` takes exactly two checked versions)
import { t } from "@/copy";
import { useHistory, useIsSelected } from "./history-context";

export function VersionCheckbox({ version }: { readonly version: number }) {
  const { store } = useHistory();
  const checked = useIsSelected(version);
  return (
    <input
      type="checkbox"
      className="h-4 w-4 cursor-pointer accent-action-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-primary"
      aria-label={t("history.select", { n: version })}
      checked={checked}
      onChange={(event) => store.setSelected(version, event.currentTarget.checked)}
      data-testid={`history-select-${version}`}
    />
  );
}
