"use client";

// The `+ ▾` menu's `Symbol` (10 §5.5): a grid of common symbols, each inserted as plain text at
// the caret. Arrow keys move in the grid; Enter or a click inserts and closes.
// spec: docs/specs/10-ui-reference.md section 5.5 (Symbol)
import { t } from "@/copy";
import { Dialog, secondaryButtonClass } from "./dialog";
import { moveInGrid } from "./pickers";

/**
 * The symbols offered: typography, arithmetic and comparison, arrows, currency, fractions and
 * Greek letters used in specifications. Every one is a single code point.
 */
export const SYMBOLS: readonly string[] = Object.freeze([
  "©", "®", "™", "§", "¶", "†", "‡", "•", "…", "–", "—", "°",
  "±", "×", "÷", "≠", "≈", "≤", "≥", "∞", "√", "∑", "∆", "‰",
  "←", "→", "↑", "↓", "↔", "⇒", "⇔", "↵", "✓", "✗", "★", "☆",
  "€", "£", "¥", "¢", "¼", "½", "¾", "¹", "²", "³", "µ", "Ω",
  "α", "β", "γ", "δ", "ε", "λ", "π", "σ", "∈", "∀", "∃", "∅",
]);

export const SYMBOL_COLUMNS = 12;

export interface SymbolDialogProps {
  readonly onPick: (symbol: string) => void;
  readonly onCancel: () => void;
  readonly fallbackFocus?: () => void;
}

// spec: docs/specs/10-ui-reference.md section 5.5 (Symbol)
export function SymbolDialog({ onPick, onCancel, fallbackFocus }: SymbolDialogProps) {
  return (
    <Dialog title={t("editor.symbol.title")} onDismiss={onCancel} testId="symbol-dialog" fallbackFocus={fallbackFocus}>
      <div
        role="group"
        aria-label={t("editor.symbol.title")}
        className="mt-4 grid gap-1"
        style={{ gridTemplateColumns: `repeat(${SYMBOL_COLUMNS}, 2rem)` }}
        onKeyDown={(event) => moveInGrid(event, SYMBOL_COLUMNS)}
      >
        {SYMBOLS.map((symbol, index) => (
          <button
            key={symbol}
            type="button"
            data-autofocus={index === 0 ? "" : undefined}
            className="h-8 w-8 rounded border border-slate-200 text-base hover:bg-slate-100 focus:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-action-primary"
            onClick={() => onPick(symbol)}
          >
            {symbol}
          </button>
        ))}
      </div>
      <div className="mt-5 flex justify-end">
        <button type="button" className={secondaryButtonClass} onClick={onCancel}>
          {t("editor.cancel")}
        </button>
      </div>
    </Dialog>
  );
}
