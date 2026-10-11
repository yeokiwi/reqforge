"use client";

// The `?` Keyboard shortcuts dialog (RD-057). Generated from SHORTCUTS, the same table the
// editor's keymap is built from (shortcuts.ts), so the two cannot disagree: one table per group,
// one row per shortcut, its keys shown as the platform's key caps (Ctrl/Alt/Shift, or ⌘/⌥/⇧ on a
// Mac). Aliases (the same key on another layout) are bound but not listed.
// spec: docs/specs/10-ui-reference.md section 5.1 (`?`); docs/specs/09-decision-log.md section RD-057
import { Fragment } from "react";
import { t } from "@/copy";
import { Dialog, secondaryButtonClass } from "./dialog";
import { SHORTCUTS, SHORTCUT_GROUPS, SHORTCUT_GROUP_COPY, type Shortcut, isMacPlatform, keyCaps, shortcutLabel } from "./shortcuts";

export interface ShortcutsDialogProps {
  readonly onClose: () => void;
  /** Defaults to the browser's platform. */
  readonly mac?: boolean;
  readonly shortcuts?: readonly Shortcut[];
  readonly fallbackFocus?: () => void;
}

function KeyCombo({ notation, mac }: { readonly notation: string; readonly mac: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keyCaps(notation, mac).map((cap, i) => (
        <kbd key={i} className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-slate-800 shadow-sm">
          {cap}
        </kbd>
      ))}
    </span>
  );
}

// spec: docs/specs/10-ui-reference.md section 5.1 (`?` keyboard shortcuts)
export function ShortcutsDialog({ onClose, mac = isMacPlatform(), shortcuts = SHORTCUTS, fallbackFocus }: ShortcutsDialogProps) {
  return (
    <Dialog title={t("editor.help")} onDismiss={onClose} testId="shortcuts-dialog" size="wide" fallbackFocus={fallbackFocus}>
      <div className="mt-4 space-y-5">
        {SHORTCUT_GROUPS.map((group) => {
          const rows = shortcuts.filter((s) => s.group === group);
          if (rows.length === 0) return null;
          return (
            <table key={group} className="w-full border-collapse text-sm" data-group={group}>
              <caption className="pb-1 text-left text-sm font-semibold text-slate-900">{t(SHORTCUT_GROUP_COPY[group])}</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">{t("editor.shortcuts.action")}</th>
                  <th scope="col">{t("editor.shortcuts.keys")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((shortcut) => (
                  <tr key={shortcut.action} data-action={shortcut.action} className="border-t border-slate-100">
                    <th scope="row" className="py-1.5 pr-4 text-left font-normal text-slate-700">
                      {shortcutLabel(shortcut)}
                    </th>
                    <td className="py-1.5 text-right">
                      {shortcut.keys.map((key, i) => (
                        <Fragment key={key}>
                          {i > 0 ? <span className="px-1 text-slate-400">/</span> : null}
                          <KeyCombo notation={key} mac={mac} />
                        </Fragment>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })}
      </div>
      <div className="mt-5 flex justify-end">
        <button type="button" className={secondaryButtonClass} onClick={onClose} data-autofocus="">
          {t("editor.dialog.close")}
        </button>
      </div>
    </Dialog>
  );
}
