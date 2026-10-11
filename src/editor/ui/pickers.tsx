"use client";

// The two grid pickers of toolbar row 1: `▦▾` (a table of the chosen size, RD-057) and `☺`
// (an emoji, inserted as plain Unicode text). Each is a group of buttons inside a popover;
// arrow keys move in two dimensions.
// spec: docs/specs/10-ui-reference.md section 5.1 (`▦▾`, `☺`); docs/specs/09-decision-log.md section RD-057
import { type KeyboardEvent, useState } from "react";
import { t } from "@/copy";
import { usePopover } from "./popover";

/** Where an arrow key moves in a grid of `count` cells, `columns` wide, or null for other keys. */
// spec: docs/specs/10-ui-reference.md section 5.1 (`▦▾` size grid)
export function nextGridIndex(key: string, index: number, columns: number, count: number): number | null {
  if (count === 0 || columns <= 0) return null;
  const at = Math.min(Math.max(index, 0), count - 1);
  switch (key) {
    case "ArrowRight":
      return Math.min(at + 1, count - 1);
    case "ArrowLeft":
      return Math.max(at - 1, 0);
    case "ArrowDown":
      return at + columns < count ? at + columns : at;
    case "ArrowUp":
      return at - columns >= 0 ? at - columns : at;
    case "Home":
      return at - (at % columns);
    case "End":
      return Math.min(at - (at % columns) + columns - 1, count - 1);
    default:
      return null;
  }
}

/** Arrow-key movement between the buttons of a grid (the size grid, emoji, symbols). */
export function moveInGrid(event: KeyboardEvent<HTMLElement>, columns: number): void {
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
  const next = nextGridIndex(event.key, buttons.indexOf(event.target as HTMLButtonElement), columns, buttons.length);
  if (next === null) return;
  event.preventDefault();
  event.stopPropagation();
  buttons[next]?.focus();
}

/** The size grid: 10 columns by 8 rows, like the common editors. */
export const TABLE_GRID = Object.freeze({ columns: 10, rows: 8 });

export interface TableSizeGridProps {
  readonly onPick: (size: { readonly rows: number; readonly cols: number }) => void;
}

export function TableSizeGrid({ onPick }: TableSizeGridProps) {
  const popover = usePopover();
  const [hover, setHover] = useState({ cols: 1, rows: 1 });
  const cells: { cols: number; rows: number }[] = [];
  for (let rows = 1; rows <= TABLE_GRID.rows; rows++) {
    for (let cols = 1; cols <= TABLE_GRID.columns; cols++) cells.push({ cols, rows });
  }
  return (
    <div className="px-3 py-2">
      <div
        role="group"
        aria-label={t("editor.table")}
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${TABLE_GRID.columns}, 1rem)` }}
        onKeyDown={(event) => moveInGrid(event, TABLE_GRID.columns)}
      >
        {cells.map((cell) => {
          const lit = cell.cols <= hover.cols && cell.rows <= hover.rows;
          return (
            <button
              key={`${cell.rows}x${cell.cols}`}
              type="button"
              aria-label={t("editor.table.sizeLabel", cell)}
              data-autofocus={cell.cols === 1 && cell.rows === 1 ? "" : undefined}
              className={`h-4 w-4 rounded-sm border focus:outline-none ${lit ? "border-action-primary bg-blue-100" : "border-slate-300 bg-white"}`}
              onMouseEnter={() => setHover(cell)}
              onFocus={() => setHover(cell)}
              onClick={() => {
                popover?.close(false);
                onPick(cell);
              }}
            />
          );
        })}
      </div>
      <p aria-hidden="true" className="mt-2 text-center text-xs text-slate-600">
        {t("editor.table.size", hover)}
      </p>
    </div>
  );
}

/**
 * The emoji offered by `☺`, as Unicode text. A plain fixed set (no search, no skin tones): the
 * video shows the button, not the picker (RD-057).
 */
export const EMOJI: readonly string[] = Object.freeze([
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🙂",
  "😉", "😊", "😍", "🤔", "😐", "😕", "😢", "😮",
  "😡", "👍", "👎", "👏", "🙌", "🙏", "💪", "👀",
  "✅", "❌", "⚠️", "❗", "❓", "💡", "📌", "📎",
  "📝", "📅", "⏰", "🔒", "🔑", "🚀", "🎉", "⭐",
  "❤️", "🔥", "🐛", "✨", "➡️", "⬅️", "⬆️", "⬇️",
]);

const EMOJI_COLUMNS = 8;

export interface EmojiGridProps {
  readonly onPick: (emoji: string) => void;
}

export function EmojiGrid({ onPick }: EmojiGridProps) {
  const popover = usePopover();
  return (
    <div
      role="group"
      aria-label={t("editor.emoji")}
      className="grid gap-0.5 px-2 py-1"
      style={{ gridTemplateColumns: `repeat(${EMOJI_COLUMNS}, 2rem)` }}
      onKeyDown={(event) => moveInGrid(event, EMOJI_COLUMNS)}
    >
      {EMOJI.map((emoji, index) => (
        <button
          key={emoji}
          type="button"
          data-autofocus={index === 0 ? "" : undefined}
          className="h-8 w-8 rounded text-lg hover:bg-slate-100 focus:bg-slate-100 focus:outline-none"
          onClick={() => {
            popover?.close(false);
            onPick(emoji);
          }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
