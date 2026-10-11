// The `E` shortcut that opens the editor from the page view (10 section 4.1: "opens the editor,
// §5; also `E`"). It must never fire while the user is typing or holding a modifier, and never
// from inside a dialog or an open menu, where a letter belongs to that widget.
// spec: docs/specs/10-ui-reference.md section 4.1 (`✎ Edit` — also `E`)

/** The parts of a KeyboardEvent the decision reads. */
export interface ShortcutEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing?: boolean;
  readonly repeat?: boolean;
  readonly defaultPrevented: boolean;
  readonly target: EventTarget | null;
}

/** Where a key press belongs to the focused widget, not to the page. */
const BLOCKING =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"], [role="dialog"], [role="menu"]';

interface ElementLike {
  closest(selector: string): unknown;
  readonly isContentEditable?: boolean;
}

function isElementLike(target: unknown): target is ElementLike {
  return typeof target === "object" && target !== null && typeof (target as { closest?: unknown }).closest === "function";
}

/**
 * Whether focus is somewhere a letter key means something else: a form field, an editable
 * region, a text-like widget, a dialog or an open menu.
 */
// spec: docs/specs/10-ui-reference.md section 4.1 (`E`), and the quality bar's "keyboard first"
export function isShortcutBlockedTarget(target: EventTarget | null): boolean {
  if (!isElementLike(target)) return false;
  if (target.isContentEditable === true) return true;
  return target.closest(BLOCKING) !== null;
}

/**
 * True for a plain `e` / `E` press (Caps Lock allowed) with no Ctrl, Meta, Alt or Shift, not
 * auto-repeated, not part of an IME composition, not already handled, and not aimed at a field.
 */
// spec: docs/specs/10-ui-reference.md section 4.1 (`✎ Edit` — also `E`)
export function isEditShortcut(event: ShortcutEvent): boolean {
  if (event.key !== "e" && event.key !== "E") return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  if (event.isComposing === true || event.repeat === true || event.defaultPrevented) return false;
  return !isShortcutBlockedTarget(event.target);
}
