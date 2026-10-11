"use client";

// The three byline icons after the breadcrumb (10 section 4.1): 🔓 restrictions, 📎 attachments,
// ⛹ requirements. Only 📎 does something in this slice — it opens the same Attachments dialog
// as `···` → Attachments. The padlock (slice 16) and the product panel (slices 2–14) hold their
// slots, inert, titled "Not available yet" (RD-059); they stay focusable so the title is
// discoverable. The padlock is open: no page can be restricted before slice 16.
// spec: docs/specs/10-ui-reference.md sections 4.1 and 4.4; docs/specs/09-decision-log.md sections RD-059, RD-078
import type { Ref } from "react";
import { t } from "@/copy";
import { RequirementsIcon } from "@/ui/icons";
import { PadlockIcon, PaperclipIcon } from "@/ui/page-view/icons";

const iconButton = "inline-flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-100 hover:text-slate-900";
const inertIcon = "inline-flex h-7 w-7 cursor-not-allowed items-center justify-center rounded text-slate-400";

export interface BylineIconsProps {
  readonly onOpenAttachments: () => void;
  readonly attachmentsRef?: Ref<HTMLButtonElement>;
}

// spec: docs/specs/09-decision-log.md section RD-059 (🔓 and ⛹ drawn inert; 📎 opens Attachments)
export function BylineIcons({ onOpenAttachments, attachmentsRef }: BylineIconsProps) {
  return (
    <div className="flex shrink-0 items-center gap-0.5" data-testid="byline-icons">
      <button type="button" aria-label={t("restrictions.title")} title={t("shell.later")} aria-disabled="true" className={inertIcon}>
        <PadlockIcon size={16} />
      </button>
      <button
        ref={attachmentsRef}
        type="button"
        aria-label={t("pageMenu.attachments")}
        title={t("pageMenu.attachments")}
        aria-haspopup="dialog"
        className={iconButton}
        onClick={onOpenAttachments}
      >
        <PaperclipIcon size={16} />
      </button>
      <button
        type="button"
        aria-label={t("pageView.byline.requirements")}
        title={t("shell.later")}
        aria-disabled="true"
        className={inertIcon}
      >
        <RequirementsIcon size={16} />
      </button>
    </div>
  );
}
