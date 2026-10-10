"use client";

// Roving focus for a role=toolbar (WAI-ARIA APG toolbar pattern): the toolbar is ONE tab stop;
// Left and Right move between its controls (wrapping), Home and End jump to the ends. Exactly
// one control carries tabindex=0: the one last focused, else the first. Controls opt in with
// `data-roving-item`; aria-disabled controls stay focusable, as the pattern recommends.
// spec: docs/specs/10-ui-reference.md section 5.1 (toolbar rows 1 and 2)
import { type FocusEvent, type KeyboardEvent, type RefObject, useCallback, useEffect, useRef } from "react";

export const ROVING_ITEM_ATTRIBUTE = "data-roving-item";
const ITEM_SELECTOR = `[${ROVING_ITEM_ATTRIBUTE}]`;

/** The controls of one toolbar, in DOM order, excluding natively disabled ones. */
export function rovingItems(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter((item) => !item.hasAttribute("disabled"));
}

/**
 * Where a key moves focus from `index` among `count` controls, or null when the key is not one
 * the toolbar handles. An index of -1 (focus is not on a control) moves to an end.
 */
// spec: docs/specs/10-ui-reference.md section 5.1 (role=toolbar, arrow-key roving focus)
export function nextRovingIndex(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowRight":
      return index < 0 ? 0 : (index + 1) % count;
    case "ArrowLeft":
      return index < 0 ? count - 1 : (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

export interface RovingHandlers {
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
}

/** Wires roving focus to the toolbar element in `ref`. Spread the handlers on that element. */
export function useRovingToolbar(ref: RefObject<HTMLElement | null>): RovingHandlers {
  const active = useRef<HTMLElement | null>(null);

  const sync = useCallback(() => {
    const container = ref.current;
    if (!container) return;
    const items = rovingItems(container);
    const current = active.current && items.includes(active.current) ? active.current : (items[0] ?? null);
    for (const item of items) item.tabIndex = item === current ? 0 : -1;
  }, [ref]);

  // Controls come and go (row 2's commands, slots filled by a later pass): resync after every render.
  useEffect(() => {
    sync();
  });

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const container = ref.current;
      const target = event.target as HTMLElement;
      if (!container || !target.matches(ITEM_SELECTOR)) return; // keys inside an open menu are the menu's
      const items = rovingItems(container);
      const next = nextRovingIndex(event.key, items.indexOf(target), items.length);
      if (next === null) return;
      const item = items[next];
      if (!item) return;
      event.preventDefault();
      active.current = item;
      sync();
      item.focus();
    },
    [ref, sync],
  );

  const onFocus = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const target = event.target as HTMLElement;
      if (!target.matches(ITEM_SELECTOR)) return;
      active.current = target;
      sync();
    },
    [sync],
  );

  return { onKeyDown, onFocus };
}
