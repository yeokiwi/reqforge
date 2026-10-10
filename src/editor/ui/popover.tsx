"use client";

// The editor's dropdowns: a trigger button and a panel (WAI-ARIA menu button pattern for
// menus; a non-modal popup for the table-size grid and the emoji picker).
//   Click, Enter, Space or ArrowDown on the trigger opens the panel and focuses the checked
//   item, else the first one. In a menu, ArrowUp/ArrowDown/Home/End move between items
//   (skipping aria-disabled ones, wrapping). Escape closes and refocuses the trigger; Tab and a
//   pointer press outside close it. Choosing an item closes the menu and runs its action, which
//   refocuses the editor.
// src/ui/menu.tsx is the shell's menu; it has no button items and no way to close from an item,
// which every editor menu needs, so the editor carries its own.
// spec: docs/specs/10-ui-reference.md section 5.1 (`Paragraph ▾`, `A▾`, `Aᵃ▾`, `▦▾`, `☺`, `fill ▾`, `···`)
import Link from "next/link";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ChevronDown } from "@/ui/icons";
import { ROVING_ITEM_ATTRIBUTE } from "./roving";

interface PopoverContextValue {
  /** Closes the panel; `refocusTrigger` returns focus to the trigger (Escape). */
  close(refocusTrigger?: boolean): void;
}

const PopoverContext = createContext<PopoverContextValue | null>(null);

/** The enclosing popover, for items that close it. */
export function usePopover(): PopoverContextValue | null {
  return useContext(PopoverContext);
}

const PLACEMENT = {
  "bottom-start": "left-0 top-full mt-1",
  "bottom-end": "right-0 top-full mt-1",
  "top-end": "bottom-full right-0 mb-1",
} as const;

const ENABLED_MENU_ITEM_SELECTOR =
  '[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemradio"]:not([aria-disabled="true"]), [role="menuitemcheckbox"]:not([aria-disabled="true"])';

export const triggerClass =
  "inline-flex h-8 items-center gap-1 rounded px-1.5 text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-action-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-expanded:bg-slate-200";

export interface PopoverProps {
  /** Accessible name of the trigger and of the panel. */
  readonly label: string;
  /** Visible text on the trigger (the current value, e.g. `Heading 1`); the trigger is then named "label value". */
  readonly valueText?: string;
  /** Visible glyph on the trigger. */
  readonly icon?: ReactNode;
  /** `menu` for a list of items; `dialog` for a picker grid. */
  readonly kind: "menu" | "dialog";
  readonly placement?: keyof typeof PLACEMENT;
  readonly disabled?: boolean;
  /** The trigger takes part in a toolbar's roving focus. */
  readonly roving?: boolean;
  /** Keep the editor focused while the trigger is pressed with a pointer (toolbars). */
  readonly keepEditorFocus?: boolean;
  readonly triggerClassName?: string;
  readonly panelClassName?: string;
  readonly showChevron?: boolean;
  readonly testId?: string;
  readonly children: ReactNode;
}

// spec: docs/specs/10-ui-reference.md section 5.1 (dropdowns of the toolbar and the footer)
export function Popover({
  label,
  valueText,
  icon,
  kind,
  placement = "bottom-start",
  disabled = false,
  roving = false,
  keepEditorFocus = false,
  triggerClassName = triggerClass,
  panelClassName = "",
  showChevron = true,
  testId,
  children,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const labelId = useId();
  const valueId = useId();

  const close = useCallback((refocusTrigger = false) => {
    setOpen(false);
    if (refocusTrigger) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (panel) {
      let target: HTMLElement | null | undefined;
      if (kind === "menu") {
        const items = Array.from(panel.querySelectorAll<HTMLElement>(ENABLED_MENU_ITEM_SELECTOR));
        target = items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0];
      } else {
        target = panel.querySelector<HTMLElement>("[data-autofocus]") ?? panel.querySelector<HTMLElement>("button, input");
      }
      target?.focus();
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, kind]);

  const toggle = () => {
    if (disabled) return;
    setOpen((value) => !value);
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
    }
  };

  const onTriggerMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    if (keepEditorFocus) event.preventDefault();
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    if (kind !== "menu") return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(ENABLED_MENU_ITEM_SELECTOR) ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => items[(i + items.length) % items.length]?.focus();
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
    }
  };

  const named = valueText !== undefined;
  return (
    <div ref={rootRef} className="relative" data-testid={testId}>
      <button
        ref={triggerRef}
        type="button"
        {...(roving ? { [ROVING_ITEM_ATTRIBUTE]: "" } : {})}
        aria-haspopup={kind}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={named ? undefined : label}
        aria-labelledby={named ? `${labelId} ${valueId}` : undefined}
        aria-disabled={disabled || undefined}
        title={label}
        className={triggerClassName}
        onMouseDown={onTriggerMouseDown}
        onClick={toggle}
        onKeyDown={onTriggerKeyDown}
      >
        {named ? (
          <span id={labelId} className="sr-only">
            {label}
          </span>
        ) : null}
        {icon}
        {named ? (
          <span id={valueId} className="truncate text-left text-sm">
            {valueText}
          </span>
        ) : null}
        {showChevron ? <ChevronDown size={12} /> : null}
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role={kind}
          aria-label={label}
          onKeyDown={onPanelKeyDown}
          className={`absolute z-40 min-w-44 rounded border border-slate-200 bg-white py-1 text-slate-900 shadow-lg ${PLACEMENT[placement]} ${panelClassName}`}
        >
          <PopoverContext.Provider value={{ close }}>{children}</PopoverContext.Provider>
        </div>
      ) : null}
    </div>
  );
}

const itemClass =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-900 no-underline hover:bg-slate-100 focus:bg-slate-100 focus:outline-none aria-disabled:cursor-not-allowed aria-disabled:text-slate-400 aria-checked:font-semibold";

export interface MenuItemProps {
  readonly onSelect: () => void;
  /** `menuitemradio` and `menuitemcheckbox` carry `checked`. */
  readonly role?: "menuitem" | "menuitemradio" | "menuitemcheckbox";
  readonly checked?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

/** One item of a menu: closes the menu, then runs `onSelect`. */
export function MenuItem({ onSelect, role = "menuitem", checked, disabled = false, className = "", children }: MenuItemProps) {
  const popover = usePopover();
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === "menuitem" ? undefined : checked === true}
      aria-disabled={disabled || undefined}
      tabIndex={-1}
      className={`${itemClass} ${className}`}
      onClick={() => {
        if (disabled) return;
        popover?.close(false);
        onSelect();
      }}
    >
      {children}
    </button>
  );
}

/** A menu item that navigates. */
export function MenuItemLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  const popover = usePopover();
  return (
    <Link href={href} role="menuitem" tabIndex={-1} className={itemClass} onClick={() => popover?.close(false)}>
      {children}
    </Link>
  );
}
