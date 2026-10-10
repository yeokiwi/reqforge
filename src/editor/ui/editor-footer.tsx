"use client";

// The editor's footer bar (10 §5.1):
//
//   Ready to go   [ What did you change?        ]  ☑ Notify watchers  [Update]  Close  ···
//
// The save state is exactly one of three copy-deck strings; anything that went wrong is a
// separate line beside it (RD-055). `What did you change?` becomes the version's change note
// (at most 500 characters, counted in code points as the server counts them, RD-063). `Notify
// watchers` starts checked (RD-061). `Update` is the primary action and is disabled while a
// publish is in flight. `···` holds Revert to last published and Page history.
// spec: docs/specs/10-ui-reference.md section 5.1 (footer); docs/specs/09-decision-log.md sections RD-055, RD-061, RD-063
import { useId } from "react";
import { t } from "@/copy";
import { LIMITS } from "@/domain/documents/limits";
import { truncateCodePoints } from "@/domain/documents/text";
import { Dots } from "@/ui/icons";
import { primaryButtonClass, secondaryButtonClass } from "./dialog";
import { type EditorMessage, messageText } from "./messages";
import { MenuItem, MenuItemLink, Popover } from "./popover";
import { SAVE_LABEL_COPY, type SaveLabel } from "./save-state";

/** The change note as typed, held to the server's limit (RD-063: at most 500 code points). */
// spec: docs/specs/07-permissions-and-limits.md section 4 (Change note); RD-063
export function clampChangeNote(value: string): string {
  return truncateCodePoints(value, LIMITS.messageMax);
}

export interface EditorFooterProps {
  readonly label: SaveLabel;
  /** Lines to show beside the save state (errors), most urgent first. */
  readonly messages: readonly EditorMessage[];
  readonly changeNote: string;
  readonly onChangeNote: (value: string) => void;
  readonly changeNoteInvalid: boolean;
  readonly notifyWatchers: boolean;
  readonly onNotifyWatchers: (value: boolean) => void;
  /** Update may be pressed (false while a publish or a reload is in flight). */
  readonly canUpdate: boolean;
  /** A publish is in flight. */
  readonly publishing: boolean;
  /** Close and the `···` actions may be used. */
  readonly canLeave: boolean;
  readonly onUpdate: () => void;
  readonly onClose: () => void;
  readonly onRevert: () => void;
  readonly historyHref: string;
}

// spec: docs/specs/10-ui-reference.md section 5.1 (save state, What did you change?, Notify watchers, Update, Close, ···)
export function EditorFooter({
  label,
  messages,
  changeNote,
  onChangeNote,
  changeNoteInvalid,
  notifyWatchers,
  onNotifyWatchers,
  canUpdate,
  publishing,
  canLeave,
  onUpdate,
  onClose,
  onRevert,
  historyHref,
}: EditorFooterProps) {
  const notifyId = useId();
  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-slate-200 bg-white px-4 py-2" data-testid="editor-footer">
      <div className="min-w-0 flex-1">
        {messages.length > 0 ? (
          <ul role="alert" className="space-y-0.5 text-sm text-red-700" data-testid="editor-errors">
            {messages.map((message) => (
              <li key={message.id}>{messageText(message)}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <span role="status" aria-live="polite" className="whitespace-nowrap text-sm text-slate-600" data-testid="save-state">
        {t(SAVE_LABEL_COPY[label])}
      </span>
      <input
        type="text"
        value={changeNote}
        placeholder={t("editor.changeNote.placeholder")}
        aria-label={t("editor.changeNote.placeholder")}
        aria-invalid={changeNoteInvalid || undefined}
        autoComplete="off"
        className={`h-8 w-72 rounded border px-2 text-sm focus:border-action-primary focus:outline-none focus:ring-1 focus:ring-action-primary ${changeNoteInvalid ? "border-red-600" : "border-slate-300"}`}
        onChange={(event) => onChangeNote(clampChangeNote(event.target.value))}
      />
      <span className="flex items-center gap-1.5">
        <input
          id={notifyId}
          type="checkbox"
          checked={notifyWatchers}
          className="h-4 w-4 accent-action-primary"
          onChange={(event) => onNotifyWatchers(event.target.checked)}
        />
        <label htmlFor={notifyId} className="text-sm text-slate-700">
          {t("editor.notifyWatchers")}
        </label>
      </span>
      <button type="button" className={primaryButtonClass} disabled={!canUpdate} aria-busy={publishing || undefined} onClick={onUpdate}>
        {t("editor.update")}
      </button>
      <button type="button" className={secondaryButtonClass} disabled={!canLeave} onClick={onClose}>
        {t("editor.close")}
      </button>
      <Popover
        kind="menu"
        label={t("editor.more")}
        icon={<Dots size={18} />}
        showChevron={false}
        placement="top-end"
        disabled={!canLeave}
        triggerClassName="inline-flex h-8 w-8 items-center justify-center rounded text-slate-700 hover:bg-slate-100 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-expanded:bg-slate-200"
      >
        <MenuItem onSelect={onRevert}>{t("editor.more.revert")}</MenuItem>
        <MenuItemLink href={historyHref}>{t("editor.more.history")}</MenuItemLink>
      </Popover>
    </footer>
  );
}
