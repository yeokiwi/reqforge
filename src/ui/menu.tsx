"use client";

// A small accessible dropdown menu (WAI-ARIA menu button pattern):
//   Enter / Space / ArrowDown on the trigger opens it and focuses the first item;
//   ArrowUp/ArrowDown/Home/End move between items; Escape closes and refocuses the trigger;
//   Tab and clicking outside close it. Disabled items are skipped by arrow keys.
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

const MenuContext = createContext<{ close: () => void } | null>(null);

interface MenuProps {
  /** Accessible name for the trigger button and the menu. */
  readonly label: string;
  readonly trigger: ReactNode;
  readonly children: ReactNode;
  /** Where the panel opens relative to the trigger. */
  readonly placement?: "bottom-start" | "bottom-end" | "top-start" | "right-end";
  readonly triggerClassName?: string;
  readonly panelClassName?: string;
  readonly testId?: string;
}

const PLACEMENT_CLASS = {
  "bottom-start": "left-0 top-full mt-1",
  "bottom-end": "right-0 top-full mt-1",
  "top-start": "bottom-full left-0 mb-1",
  "right-end": "bottom-0 left-full ml-2",
} as const;

const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])';

export function Menu({
  label,
  trigger,
  children,
  placement = "bottom-start",
  triggerClassName = "",
  panelClassName = "",
  testId,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusFirst = useRef(false);
  const panelId = useId();

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  const items = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);

  useEffect(() => {
    if (!open) return;
    if (focusFirst.current) items()[0]?.focus();
    focusFirst.current = false;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusFirst.current = true;
      setOpen(true);
    }
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => list[(i + list.length) % list.length]?.focus();
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index <= 0 ? -1 : index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusAt(0);
        break;
      case "End":
        event.preventDefault();
        focusAt(-1);
        break;
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "Tab":
        close();
        break;
    }
  };

  return (
    <div ref={rootRef} className="relative" data-testid={testId}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={label}
        className={triggerClassName}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        {trigger}
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="menu"
          aria-label={label}
          onKeyDown={onPanelKeyDown}
          className={`absolute z-30 min-w-52 rounded border border-slate-200 bg-white py-1 text-slate-900 shadow-lg ${PLACEMENT_CLASS[placement]} ${panelClassName}`}
        >
          <MenuContext.Provider value={{ close: () => close() }}>{children}</MenuContext.Provider>
        </div>
      ) : null}
    </div>
  );
}

const itemClass =
  "block w-full px-4 py-2 text-left text-sm text-slate-900 no-underline hover:bg-slate-100 focus:bg-slate-100";
const disabledClass = "block w-full cursor-not-allowed px-4 py-2 text-left text-sm text-slate-400";

export function MenuLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  const menu = useContext(MenuContext);
  return (
    <Link href={href} role="menuitem" tabIndex={-1} className={itemClass} onClick={() => menu?.close()}>
      {children}
    </Link>
  );
}

/** A visible but inert item, for things that ship in a later slice (10 §0, status `later`). */
export function MenuItemDisabled({ children, title }: { readonly children: ReactNode; readonly title?: string }) {
  return (
    <span role="menuitem" aria-disabled="true" title={title} className={disabledClass}>
      {children}
    </span>
  );
}

/** A heading row that is not itself an item (e.g. "Recent"). */
export function MenuLabel({ children }: { readonly children: ReactNode }) {
  return (
    <div role="presentation" className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 border-t border-slate-200" />;
}

/** Wrap a <button> (e.g. a sign-out submit) so it is a proper menu item. */
export const menuItemButtonClass = itemClass;
