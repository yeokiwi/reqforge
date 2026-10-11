// Find and replace in the page (`🔍`, RD-057): a ProseMirror plugin that holds the query, finds
// the matches, decorates them, and moves between them; replacing goes through transactions, so
// every replace is undoable, and Replace all is ONE transaction (one undo step).
//
// What a match is: the query, found in the text of one textblock (a paragraph, a heading, a code
// block, a cell's paragraph), across mark boundaries (`he**llo**` matches `hello`), never across
// two blocks and never through an inline atom (a status, a date, a mention, an image or a line
// break stands in as one character no query can contain). Matches do not overlap: the search
// runs left to right and resumes after each match, so `aa` in `aaaa` is two matches (at 0 and 2),
// exactly the ones a Replace all consumes. Case-insensitive unless Match case is ticked, with
// Unicode simple case folding (the `iu` RegExp flags), which keeps every match at its original
// offsets.
//
// What a replace can never do is produce content the schema refuses (RD-063, RD-068): the
// replacement is plain text, cleaned of U+0000, unpaired surrogates and line breaks, and it is
// written into the same textblock with the marks the matched text began with, which that block
// already allows.
// spec: docs/specs/09-decision-log.md sections RD-057 (`🔍` find and replace), RD-063, RD-068
import type { Node as PMNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { stripUnstorable } from "./paste";

export interface FindMatch {
  readonly from: number;
  readonly to: number;
}

/** Above this many matches the search stops and the count says "more than". */
export const MAX_FIND_MATCHES = 10_000;

/** Stands in for an inline atom in a textblock's searchable text: one position, never matched. */
const ATOM = "\uFFFC";

export interface FindResult {
  readonly matches: readonly FindMatch[];
  /** The search stopped at MAX_FIND_MATCHES. */
  readonly capped: boolean;
}

/**
 * The query as a literal pattern. Only RegExp syntax characters are escaped: under the `u` flag
 * an identity escape of anything else (`\-`, `\#`) is a SyntaxError, which would make a query
 * like `REQ-001` find nothing.
 */
export function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}

/** The query as it is searched: the atom placeholder removed (nothing could match it). */
function searchable(query: string): string {
  return query.split(ATOM).join("");
}

/**
 * Every match of `query` in `doc`, in document order. Pure: same document, query and case
 * setting, same result.
 */
// spec: docs/specs/09-decision-log.md section RD-057 (`🔍` find in the page)
export function findMatches(doc: PMNode, query: string, caseSensitive: boolean, limit = MAX_FIND_MATCHES): FindResult {
  const needle = searchable(query);
  if (needle.length === 0) return { matches: [], capped: false };
  let pattern: RegExp;
  try {
    pattern = new RegExp(escapeRegExp(needle), caseSensitive ? "gu" : "giu");
  } catch {
    return { matches: [], capped: false };
  }
  const matches: FindMatch[] = [];
  let capped = false;
  doc.descendants((node, pos) => {
    if (capped) return false;
    if (!node.isTextblock) return true;
    // Every inline child of our schema is text or a leaf of size 1, so offset i of this string
    // is document position pos + 1 + i.
    let text = "";
    node.forEach((child) => {
      text += child.isText ? (child.text ?? "") : ATOM.repeat(child.nodeSize);
    });
    pattern.lastIndex = 0;
    for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
      if (m[0].length === 0) {
        pattern.lastIndex += 1;
        continue;
      }
      if (matches.length >= limit) {
        capped = true;
        break;
      }
      const from = pos + 1 + m.index;
      matches.push({ from, to: from + m[0].length });
    }
    return false; // inline content is searched as text above
  });
  return { matches, capped };
}

/** Replacement text as it may be written: storable (RD-068), on one line. */
// spec: docs/specs/09-decision-log.md section RD-068 (strings the database cannot hold)
export function cleanReplacement(text: string): string {
  return stripUnstorable(text).replace(/[\r\n\u2028\u2029]+/g, " ");
}

// ------------------------------------------------------------------------------- the plugin

export interface FindState {
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly matches: readonly FindMatch[];
  readonly capped: boolean;
  /** Index of the current match, or -1. */
  readonly current: number;
}

export const EMPTY_FIND_STATE: FindState = Object.freeze({ query: "", caseSensitive: false, matches: [], capped: false, current: -1 });

type FindMeta =
  | { readonly type: "search"; readonly query: string; readonly caseSensitive: boolean; readonly from: number }
  | { readonly type: "current"; readonly index: number }
  /** After a replace: the next match at or after `from`. */
  | { readonly type: "after"; readonly from: number }
  | { readonly type: "clear" };

export const findKey = new PluginKey<FindState>("rfFind");

/** Index of the first match at or after `pos`, wrapping to the first; -1 when there is none. */
export function matchIndexFrom(matches: readonly FindMatch[], pos: number): number {
  if (matches.length === 0) return -1;
  const index = matches.findIndex((m) => m.from >= pos);
  return index < 0 ? 0 : index;
}

function research(doc: PMNode, query: string, caseSensitive: boolean, from: number): FindState {
  const { matches, capped } = findMatches(doc, query, caseSensitive);
  return { query, caseSensitive, matches, capped, current: matchIndexFrom(matches, from) };
}

function applyFind(tr: Transaction, previous: FindState): FindState {
  const meta = tr.getMeta(findKey) as FindMeta | undefined;
  if (meta?.type === "clear") return EMPTY_FIND_STATE;
  if (meta?.type === "search") return research(tr.doc, meta.query, meta.caseSensitive, meta.from);
  if (previous.query.length === 0) return previous;
  if (meta?.type === "current") {
    const index = previous.matches.length === 0 ? -1 : ((meta.index % previous.matches.length) + previous.matches.length) % previous.matches.length;
    return { ...previous, current: index };
  }
  if (meta?.type === "after") return research(tr.doc, previous.query, previous.caseSensitive, meta.from);
  if (!tr.docChanged) return previous;
  // The document changed under an open search: search again, staying near the current match.
  const at = previous.matches[previous.current];
  const from = at ? tr.mapping.map(at.from, -1) : 0;
  return research(tr.doc, previous.query, previous.caseSensitive, from);
}

export const FIND_MATCH_CLASS = "rf-find-match";
export const FIND_CURRENT_CLASS = "rf-find-match--current";

/** The find plugin: state, and a decoration on every match (the current one marked). */
// spec: docs/specs/09-decision-log.md section RD-057 (`🔍`)
export function findPlugin(): Plugin<FindState> {
  return new Plugin<FindState>({
    key: findKey,
    state: {
      init: () => EMPTY_FIND_STATE,
      apply: (tr, previous) => applyFind(tr, previous),
    },
    props: {
      decorations(state) {
        const find = findKey.getState(state);
        if (!find || find.matches.length === 0) return DecorationSet.empty;
        return DecorationSet.create(
          state.doc,
          find.matches.map((m, i) =>
            Decoration.inline(m.from, m.to, { class: i === find.current ? `${FIND_MATCH_CLASS} ${FIND_CURRENT_CLASS}` : FIND_MATCH_CLASS }),
          ),
        );
      },
    },
  });
}

export function findState(state: EditorState): FindState {
  return findKey.getState(state) ?? EMPTY_FIND_STATE;
}

type Dispatch = (tr: Transaction) => void;

function selectMatch(tr: Transaction, match: FindMatch | undefined): Transaction {
  if (!match) return tr;
  return tr.setSelection(TextSelection.create(tr.doc, match.from, match.to)).scrollIntoView();
}

/** Searches; the current match is the first at or after the selection, and is selected. */
// spec: docs/specs/09-decision-log.md section RD-057 (`🔍`)
export function setFindQuery(state: EditorState, dispatch: Dispatch, query: string, caseSensitive: boolean): void {
  const tr = state.tr.setMeta(findKey, { type: "search", query, caseSensitive, from: state.selection.from } satisfies FindMeta);
  tr.setMeta("addToHistory", false);
  const next = research(state.doc, query, caseSensitive, state.selection.from);
  dispatch(selectMatch(tr, next.matches[next.current]));
}

/** Next (+1) or previous (-1) match, wrapping; selects it and scrolls to it. */
// spec: docs/specs/09-decision-log.md section RD-057 (`🔍`)
export function moveFindMatch(state: EditorState, dispatch: Dispatch, delta: 1 | -1): boolean {
  const find = findState(state);
  if (find.matches.length === 0) return false;
  const index = (find.current + delta + find.matches.length) % find.matches.length;
  const tr = state.tr.setMeta(findKey, { type: "current", index } satisfies FindMeta);
  dispatch(selectMatch(tr, find.matches[index]));
  return true;
}

/** Clears the search and its decorations. */
export function clearFind(state: EditorState, dispatch: Dispatch): void {
  if (findState(state).query.length === 0) return;
  dispatch(state.tr.setMeta(findKey, { type: "clear" } satisfies FindMeta).setMeta("addToHistory", false));
}

/** Writes `replacement` over one match, in `tr`, keeping the marks of the match's first character. */
function replaceIn(tr: Transaction, match: FindMatch, replacement: string): void {
  if (replacement.length === 0) {
    tr.delete(match.from, match.to);
    return;
  }
  const marks = tr.doc.nodeAt(match.from)?.marks ?? [];
  tr.replaceWith(match.from, match.to, tr.doc.type.schema.text(replacement, marks));
}

/** Replaces the current match and moves to the next one after the replacement. */
// spec: docs/specs/09-decision-log.md section RD-057 (`🔍` replace); RD-068
export function replaceCurrentMatch(state: EditorState, dispatch: Dispatch, replacement: string): boolean {
  const find = findState(state);
  const match = find.matches[find.current];
  if (!match) return false;
  const text = cleanReplacement(replacement);
  const tr = state.tr;
  replaceIn(tr, match, text);
  const after = match.from + text.length;
  tr.setMeta(findKey, { type: "after", from: after } satisfies FindMeta);
  const next = research(tr.doc, find.query, find.caseSensitive, after);
  dispatch(selectMatch(tr, next.matches[next.current]));
  return true;
}

/** Replaces every match in ONE transaction (one undo step). Returns how many were replaced. */
// spec: docs/specs/09-decision-log.md section RD-057 (`🔍` replace all); RD-068
export function replaceAllMatches(state: EditorState, dispatch: Dispatch, replacement: string): number {
  const find = findState(state);
  if (find.matches.length === 0) return 0;
  const text = cleanReplacement(replacement);
  const tr = state.tr;
  // Last to first, so the earlier positions stay valid.
  for (let i = find.matches.length - 1; i >= 0; i--) {
    const match = find.matches[i];
    if (match) replaceIn(tr, match, text);
  }
  dispatch(tr.scrollIntoView());
  return find.matches.length;
}

/** What the find bar's count says, from the plugin state (null: say nothing). */
export type FindCount =
  | { readonly kind: "none" }
  | { readonly kind: "count"; readonly current: number; readonly total: number }
  | { readonly kind: "capped"; readonly current: number; readonly total: number };

// spec: docs/specs/09-decision-log.md section RD-057 (`🔍`: a match count)
export function findCount(find: FindState): FindCount | null {
  if (find.query.length === 0) return null;
  if (find.matches.length === 0) return { kind: "none" };
  const current = find.current + 1;
  return find.capped ? { kind: "capped", current, total: find.matches.length } : { kind: "count", current, total: find.matches.length };
}
