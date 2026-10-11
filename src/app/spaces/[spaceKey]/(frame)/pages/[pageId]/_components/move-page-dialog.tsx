"use client";

// `···` → Move (10 section 4.1, RD-059). Moving reparents a page within its space (RD-056); its
// child pages go with it. The dialog lists every place it may go — `At the top level`, then the
// space's pages in tree order, indented — leaving out the page itself and all its descendants
// (it cannot go under itself). The list is a single-select listbox: Up/Down/Home/End choose,
// and a filter field above it narrows it by title (then each match shows where it is). The page's
// present place is marked and chosen at first, and Move stays unavailable until another place is
// chosen. The request is `{ parentId, index }` with the index that puts the page last among its
// new siblings.
// spec: docs/specs/10-ui-reference.md section 4.1; docs/specs/09-decision-log.md sections RD-056, RD-059, RD-067, RD-070
import { useRouter } from "next/navigation";
import { type FormEvent, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { t } from "@/copy";
import type { PageDetail, PageSummary } from "@/domain/documents/api-types";
import type { FetchLike } from "@/ui/api-client";
import { Dialog } from "@/ui/dialog";
import { moveFailureMessage } from "../_lib/dialog-messages";
import { type MoveTarget, filterMoveTargets, moveBodyFor, moveTargets } from "../_lib/move-targets";
import { requestMove } from "../_lib/page-requests";
import { DialogAlert, DialogFooter, DialogStatus, dialogPrimaryClass, dialogSecondaryClass } from "./dialog-parts";

export interface MovePageDialogProps {
  readonly space: { readonly key: string; readonly name: string };
  readonly page: PageDetail;
  /** The space's live pages, flat (listPageTree). */
  readonly pages: readonly PageSummary[];
  readonly onClose: () => void;
  readonly fetchImpl?: FetchLike;
}

/** A target's identity in this component: its parent id, with "" for the top level (ids are never empty). */
const keyOf = (target: MoveTarget): string => target.parentId ?? "";

// spec: docs/specs/09-decision-log.md section RD-056 (moving within one space; never under itself or a descendant)
export function MovePageDialog({ space, page, pages, onClose, fetchImpl }: MovePageDialogProps) {
  const router = useRouter();
  const targets = useMemo(() => moveTargets(pages, page.id, page.parentId), [pages, page.id, page.parentId]);
  const [query, setQuery] = useState("");
  const visible = useMemo(() => filterMoveTargets(targets, query), [targets, query]);
  const currentKey = targets.find((target) => target.current) ? (page.parentId ?? "") : null;
  const [selectedKey, setSelectedKey] = useState<string | null>(currentKey);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const filterId = useId();
  const choiceId = useId();

  const indexByKey = useMemo(() => new Map(targets.map((target, index) => [keyOf(target), index])), [targets]);
  const optionId = (target: MoveTarget) => `${baseId}-option-${indexByKey.get(keyOf(target)) ?? 0}`;
  const selected = selectedKey === null ? undefined : targets.find((target) => keyOf(target) === selectedKey);
  const activeVisible = selected !== undefined && visible.includes(selected) ? selected : undefined;
  const activeId = activeVisible !== undefined ? optionId(activeVisible) : undefined;
  const unchanged = selected === undefined || selected.current;
  const matchesSomething = visible.some((target) => target.parentId !== null);

  // Keep the chosen option in view as the arrows move through a long list.
  useEffect(() => {
    if (activeId === undefined) return;
    document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  const dismiss = () => {
    if (!busyRef.current) onClose();
  };

  const choose = (target: MoveTarget | undefined) => {
    if (target === undefined || busyRef.current) return;
    setSelectedKey(keyOf(target));
    setAlert(null);
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (visible.length === 0) return;
    const at = activeVisible === undefined ? -1 : visible.indexOf(activeVisible);
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = at < 0 ? 0 : Math.min(at + 1, visible.length - 1);
        break;
      case "ArrowUp":
        next = at < 0 ? 0 : Math.max(at - 1, 0);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = visible.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    choose(visible[next]);
  };

  const onFilterKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (activeVisible === undefined) choose(visible[0]);
      list.current?.focus();
    } else if (event.key === "Enter") {
      // Enter in the filter picks the first matching page; it never submits the move.
      event.preventDefault();
      choose(visible.find((target) => target.parentId !== null) ?? visible[0]);
      list.current?.focus();
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current || selected === undefined || unchanged) return;
    busyRef.current = true;
    setBusy(true);
    setAlert(null);
    try {
      await requestMove(space.key, page.id, moveBodyFor(pages, page.id, selected.parentId), fetchImpl);
      onClose();
      router.refresh();
    } catch (error) {
      setAlert(moveFailureMessage(error));
      busyRef.current = false;
      setBusy(false);
    }
  };

  const choice =
    selected === undefined
      ? ""
      : selected.current
        ? t("pageMove.choice.same")
        : selected.parentId === null
          ? t("pageMove.choice.root", { space: space.name })
          : t("pageMove.choice.under", { parent: selected.title });

  return (
    <Dialog
      title={t("pageMove.title", { title: page.title })}
      description={t("pageMove.body", { space: space.name })}
      onDismiss={dismiss}
      testId="move-page-dialog"
      size="wide"
    >
      <form className="mt-4" noValidate onSubmit={(event) => void submit(event)}>
        <label htmlFor={filterId} className="block text-sm font-medium text-slate-800">
          {t("pageMove.filter")}
        </label>
        <input
          id={filterId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onFilterKeyDown}
          aria-controls={`${baseId}-list`}
          autoComplete="off"
          spellCheck={false}
          data-autofocus=""
          className="mt-1 h-9 w-full rounded border border-slate-300 px-2 text-sm text-slate-900 focus:border-action-primary"
        />
        <div
          ref={list}
          id={`${baseId}-list`}
          role="listbox"
          tabIndex={0}
          aria-label={t("pageMove.list")}
          aria-activedescendant={activeId}
          aria-describedby={choiceId}
          onKeyDown={onListKeyDown}
          className="mt-3 max-h-72 overflow-y-auto rounded border border-slate-200 py-1 text-sm focus:outline focus:outline-2 focus:outline-action-primary"
          data-testid="move-targets"
        >
          {visible.map((target) => {
            const isSelected = selected !== undefined && keyOf(target) === keyOf(selected);
            const filtered = query.trim() !== "";
            return (
              <div
                key={keyOf(target)}
                id={optionId(target)}
                role="option"
                aria-selected={isSelected}
                onClick={() => choose(target)}
                style={{ paddingLeft: `${0.5 + (target.parentId === null || filtered ? 0 : target.depth + 1) * 1.25}rem` }}
                className={`flex cursor-pointer items-baseline gap-2 py-1 pr-2 ${isSelected ? "bg-surface-sidebar-selected font-semibold" : "hover:bg-slate-100"}`}
              >
                <span className="min-w-0 break-words">{target.parentId === null ? t("pageMove.root") : target.title}</span>
                {filtered && target.path.length > 0 ? <span className="min-w-0 truncate text-xs text-slate-500">{target.path.join(" / ")}</span> : null}
                {target.current ? (
                  <span className="shrink-0 rounded bg-slate-100 px-1 text-xs font-normal text-slate-700">{t("pageMove.currentTag")}</span>
                ) : null}
              </div>
            );
          })}
        </div>
        <DialogStatus message={query.trim() !== "" && !matchesSomething ? t("pageMove.none", { q: query.trim() }) : ""} visible />
        <p id={choiceId} className="mt-3 text-sm text-slate-700" data-testid="move-choice">
          {choice}
        </p>
        <DialogAlert message={alert} />
        <DialogStatus message={busy ? t("pageMove.busy") : ""} />
        <DialogFooter>
          <button type="button" className={dialogSecondaryClass} aria-disabled={busy || undefined} onClick={dismiss}>
            {t("pageView.dialog.cancel")}
          </button>
          <button
            type="submit"
            className={dialogPrimaryClass}
            aria-disabled={busy || unchanged || undefined}
            aria-busy={busy || undefined}
            aria-describedby={choiceId}
          >
            {t("pageMove.submit")}
          </button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
