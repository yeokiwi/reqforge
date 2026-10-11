"use client";

// The `{` Macro suggestions popup (10 §5.4), drawn as the video draws it:
//
//   Macro suggestions
//     ⓘ Info
//     ═ Status
//     ▦ Gallery
//     ☰ Table of Contents
//     ⛹ Requirement
//     ··· Open macro browser
//
// under the typed `{query`. It renders the controller's state (suggestion.ts) and nothing else;
// the keyboard is handled in the editor (focus never leaves the text), the mouse here.
// spec: docs/specs/10-ui-reference.md section 5.4 (`{` Macro suggestions)
import { useSyncExternalStore } from "react";
import { t } from "@/copy";
import { CLOSED_SUGGESTIONS, type MacroSuggestionController } from "./suggestion";

export interface MacroSuggestionListProps {
  readonly controller: MacroSuggestionController;
}

// spec: docs/specs/10-ui-reference.md section 5.4
export function MacroSuggestionList({ controller }: MacroSuggestionListProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, () => CLOSED_SUGGESTIONS);
  if (!state.open) return null;
  const titleId = `${controller.id}-title`;
  const style = state.anchor ? { left: Math.max(0, state.anchor.left), top: state.anchor.bottom + 4 } : undefined;
  return (
    <div
      className="fixed z-50 w-64 rounded border border-slate-200 bg-white py-1 text-slate-900 shadow-lg"
      style={style}
      data-testid="macro-suggestions"
      onMouseDown={(event) => event.preventDefault()}
    >
      <p id={titleId} className="px-3 pb-1 pt-0.5 text-xs font-semibold uppercase text-slate-500">
        {t("autocomplete.title")}
      </p>
      <ul id={controller.id} role="listbox" aria-labelledby={titleId}>
        {state.items.map((item, index) => {
          const active = index === state.active;
          return (
            <li
              key={item.kind === "macro" ? item.id : "browser"}
              id={controller.optionId(index)}
              role="option"
              aria-selected={active}
              aria-disabled={item.disabled || undefined}
              title={item.disabled ? t("shell.later") : undefined}
              data-item={item.kind === "macro" ? item.id : "browser"}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1 text-sm aria-disabled:cursor-not-allowed aria-disabled:text-slate-400 ${active ? "bg-slate-100" : ""}`}
              onMouseEnter={() => controller.setActive(index)}
              onClick={() => controller.chooseItem(index)}
            >
              <span aria-hidden="true" className="w-5 text-center">
                {item.glyph}
              </span>
              <span>{item.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
