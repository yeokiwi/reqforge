"use client";

// Someone published while this editor was open (RD-055): an autosave answered `stale: true`, or
// Update answered VERSION_CONFLICT. The editor offers exactly two ways out — Overwrite (publish
// these changes as a new version on top) and Reload latest (discard them, open the current
// version). Merge is not built (RD-055).
// spec: docs/specs/09-decision-log.md section RD-055 (Concurrency); docs/specs/10-ui-reference.md section 5.1
import { t } from "@/copy";
import { primaryButtonClass, secondaryButtonClass } from "./dialog";

export interface ConflictBannerProps {
  /** The page's current version number, newer than the one this editor opened from. */
  readonly currentVersion: number;
  /** An Update or a reload is in flight. */
  readonly busy: boolean;
  readonly onOverwrite: () => void;
  readonly onReload: () => void;
}

// spec: docs/specs/09-decision-log.md section RD-055 (Overwrite, Reload latest; no merge)
export function ConflictBanner({ currentVersion, busy, onOverwrite, onReload }: ConflictBannerProps) {
  return (
    <div role="alert" className="shrink-0 border-b border-amber-300 bg-amber-50 px-6 py-3 text-sm text-slate-900" data-testid="conflict-banner">
      <p className="font-semibold">{t("editor.conflict.message", { n: currentVersion })}</p>
      <p className="mt-1 text-slate-700">{t("editor.conflict.help")}</p>
      <div className="mt-2 flex gap-2">
        <button type="button" className={primaryButtonClass} disabled={busy} onClick={onOverwrite}>
          {t("editor.conflict.overwrite")}
        </button>
        <button type="button" className={`${secondaryButtonClass} border border-slate-300 bg-white`} disabled={busy} onClick={onReload}>
          {t("editor.conflict.reload")}
        </button>
      </div>
    </div>
  );
}
