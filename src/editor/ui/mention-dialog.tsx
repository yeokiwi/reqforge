"use client";

// The `+ ▾` menu's `User mention` (10 §5.5): a name box that searches the people who can view the
// space (GET /spaces/{spaceKey}/people?q=, 08 §3: up to 10, matched on the start of the name,
// never on an email address) after a short pause in typing, and a list of results. It is a
// combobox: ArrowDown and ArrowUp move through the results while focus stays in the box, Enter
// mentions the highlighted person, Escape closes. Each new search cancels the one before, so a
// slow answer to an old query can never replace a newer one.
// spec: docs/specs/10-ui-reference.md section 5.5 (User mention); docs/specs/08-api-surface.md section 3 (GET /people)
import { type KeyboardEvent, useEffect, useId, useState } from "react";
import { t } from "@/copy";
import type { UserRef } from "@/domain/documents/api-types";
import { initials } from "@/ui/initials";
import { Dialog, secondaryButtonClass } from "./dialog";

/** How long typing must pause before a search is sent. */
export const MENTION_SEARCH_DEBOUNCE_MS = 200;

type SearchState =
  | { readonly kind: "searching" }
  | { readonly kind: "done"; readonly q: string; readonly people: readonly UserRef[] }
  | { readonly kind: "failed" };

export interface MentionDialogProps {
  readonly search: (q: string, signal: AbortSignal) => Promise<readonly UserRef[]>;
  readonly onPick: (user: UserRef) => void;
  readonly onCancel: () => void;
  readonly fallbackFocus?: () => void;
}

// spec: docs/specs/10-ui-reference.md section 5.5 (User mention)
export function MentionDialog({ search, onPick, onCancel, fallbackFocus }: MentionDialogProps) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ kind: "searching" });
  const [active, setActive] = useState(0);
  const inputId = useId();
  const listId = useId();
  const statusId = useId();

  useEffect(() => {
    const controller = new AbortController();
    const q = query.trim();
    setState({ kind: "searching" });
    const timer = setTimeout(() => {
      search(q, controller.signal).then(
        (people) => {
          if (controller.signal.aborted) return;
          setState({ kind: "done", q, people });
          setActive(0);
        },
        () => {
          if (!controller.signal.aborted) setState({ kind: "failed" });
        },
      );
    }, MENTION_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, search]);

  const people = state.kind === "done" ? state.people : [];
  const optionId = (i: number) => `${listId}-${i}`;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (people.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % people.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i - 1 + people.length) % people.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const person = people[active];
      if (person) onPick(person);
    }
  };

  let status: string | null = null;
  if (state.kind === "searching") status = t("editor.mention.searching");
  else if (state.kind === "failed") status = t("editor.mention.failed");
  else if (people.length === 0 && state.q.length > 0) status = t("editor.mention.none", { q: state.q });

  return (
    <Dialog title={t("editor.mention.title")} onDismiss={onCancel} testId="mention-dialog" fallbackFocus={fallbackFocus}>
      <div className="mt-4">
        <label htmlFor={inputId} className="block text-sm font-medium">
          {t("editor.mention.search")}
        </label>
        <input
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          value={query}
          data-autofocus=""
          aria-autocomplete="list"
          aria-expanded={people.length > 0}
          aria-controls={listId}
          aria-activedescendant={people.length > 0 ? optionId(active) : undefined}
          aria-describedby={statusId}
          className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-action-primary focus:outline-none focus:ring-1 focus:ring-action-primary"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <p id={statusId} role="status" className="mt-2 min-h-5 text-sm text-slate-600">
        {status}
      </p>
      <ul id={listId} role="listbox" aria-label={t("editor.mention.results")} className="mt-1 max-h-64 overflow-y-auto">
        {people.map((person, i) => (
          <li
            key={person.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm ${i === active ? "bg-slate-100" : ""}`}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(person)}
          >
            <span aria-hidden="true" className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-action-primary text-xs font-semibold text-white">
              {initials(person.name)}
            </span>
            <span>{person.name}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end">
        <button type="button" className={secondaryButtonClass} onClick={onCancel}>
          {t("editor.cancel")}
        </button>
      </div>
    </Dialog>
  );
}
