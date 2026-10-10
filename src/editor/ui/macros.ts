// The macros the editor knows, and the `{` Macro suggestions list built from them (10 §5.4).
//
// One catalogue serves the `{` list, the `+ ▾` menu's macro items and the macro browser. A macro
// is available now (`v1`), in slice 2 (Requirement, PLAN.md) or in a later slice; the ones that
// are not available are drawn, disabled, so the layout is final (RD-052 draws `later` the same
// way). The `{` list shows, in the drawn order, Info · Status · Gallery · Table of Contents ·
// Requirement · Open macro browser; typing after `{` filters by name; once the user has inserted
// a macro, the ones used most recently come first. Recency is remembered per browser in
// localStorage, and every storage access is guarded: a page whose storage throws (privacy modes,
// a full quota, a sandboxed frame) still gets the list, in the drawn order.
// spec: docs/specs/10-ui-reference.md sections 5.4 (`{` Macro suggestions) and 5.5 (Insert More Content menu, Other macros)
import { type ParamlessCopyId, t } from "@/copy";

export type MacroId =
  | "info"
  | "status"
  | "gallery"
  | "toc"
  | "requirement"
  | "externalIssue"
  | "requirementReport"
  | "traceabilityMatrix"
  | "baseline";

/** `v1` ships now; `slice2` is Requirement (PLAN.md slice 2); `later` holds a slot. */
export type MacroAvailability = "v1" | "slice2" | "later";

export interface Macro {
  readonly id: MacroId;
  readonly label: ParamlessCopyId;
  /** The glyph 10 §5.4 draws beside it; decorative. */
  readonly glyph: string;
  readonly availability: MacroAvailability;
}

/**
 * Every macro, in the macro browser's order: the `{` list's macros as drawn, then the three
 * `Other macros` names in 10 §5.5, then the external-issue macro (RD-031 relabels the video's
 * `Jira Issue/Filter`; it ships with integrations, phase 3).
 */
// spec: docs/specs/10-ui-reference.md sections 5.4 and 5.5
export const MACROS: readonly Macro[] = Object.freeze([
  { id: "info", label: "editor.macro.info", glyph: "ⓘ", availability: "v1" },
  { id: "status", label: "editor.macro.status", glyph: "═", availability: "v1" },
  { id: "gallery", label: "editor.macro.gallery", glyph: "▦", availability: "later" },
  { id: "toc", label: "editor.macro.toc", glyph: "☰", availability: "v1" },
  { id: "requirement", label: "editor.macro.requirement", glyph: "⛹", availability: "slice2" },
  { id: "requirementReport", label: "editor.macro.requirementReport", glyph: "▤", availability: "later" },
  { id: "traceabilityMatrix", label: "editor.macro.traceabilityMatrix", glyph: "⊞", availability: "later" },
  { id: "baseline", label: "editor.macro.baseline", glyph: "◫", availability: "later" },
  { id: "externalIssue", label: "editor.insert.externalIssue", glyph: "⧉", availability: "later" },
] satisfies Macro[]);

/** The `{` list's macros, in the order 10 §5.4 draws them. */
export const SUGGESTED_MACROS: readonly MacroId[] = Object.freeze(["info", "status", "gallery", "toc", "requirement"] satisfies MacroId[]);

/** The glyph of `··· Open macro browser`. */
export const BROWSER_GLYPH = "···";

export function macro(id: MacroId): Macro {
  const found = MACROS.find((m) => m.id === id);
  if (!found) throw new RangeError(`unknown macro ${id}`);
  return found;
}

export function isMacroId(value: unknown): value is MacroId {
  return typeof value === "string" && MACROS.some((m) => m.id === value);
}

/** Whether a macro can be inserted now. */
export function isMacroAvailable(id: MacroId): boolean {
  return macro(id).availability === "v1";
}

export function macroName(id: MacroId): string {
  return t(macro(id).label);
}

/**
 * Whether a name matches what was typed after `{`: case-insensitively, the name or any word of it
 * starts with the query (`req` → Requirement, `con` → Table of Contents). An empty query matches.
 */
// spec: docs/specs/10-ui-reference.md section 5.4 (typing after `{` filters by name)
export function matchesMacroQuery(name: string, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (q.length === 0) return true;
  const lower = name.toLocaleLowerCase();
  if (lower.startsWith(q)) return true;
  return lower.split(/\s+/).some((word) => word.startsWith(q));
}

/** `ids` with the recent ones first (most recent first), the rest in their own order. */
// spec: docs/specs/10-ui-reference.md section 5.4 (the list reorders by recency once the user has inserted something)
export function orderByRecency<T extends string>(ids: readonly T[], recents: readonly string[]): T[] {
  const recent = recents.filter((r): r is T => (ids as readonly string[]).includes(r));
  const unique = [...new Set(recent)];
  return [...unique, ...ids.filter((id) => !unique.includes(id))];
}

export type SuggestionItem =
  | { readonly kind: "macro"; readonly id: MacroId; readonly label: string; readonly glyph: string; readonly disabled: boolean }
  | { readonly kind: "browser"; readonly label: string; readonly glyph: string; readonly disabled: false };

/**
 * The `{` list for a query: the matching macros (recent ones first), then `Open macro browser`.
 * When nothing matches — not even `Open macro browser` by its own name — the list is empty, so
 * the popup closes and Enter goes back to the text: typing `{a, b}` is not hijacked.
 */
// spec: docs/specs/10-ui-reference.md section 5.4
export function macroSuggestions(query: string, recents: readonly string[] = []): SuggestionItem[] {
  const matching = orderByRecency(SUGGESTED_MACROS, recents).filter((id) => matchesMacroQuery(macroName(id), query));
  const items: SuggestionItem[] = matching.map((id) => ({
    kind: "macro",
    id,
    label: macroName(id),
    glyph: macro(id).glyph,
    disabled: !isMacroAvailable(id),
  }));
  const browser = t("autocomplete.browser");
  if (items.length > 0 || matchesMacroQuery(browser, query)) {
    items.push({ kind: "browser", label: browser, glyph: BROWSER_GLYPH, disabled: false });
  }
  return items;
}

/** The macro browser's list for its search box: every macro, available or not. */
// spec: docs/specs/10-ui-reference.md section 5.5 (`Other macros` opens the macro browser)
export function browserMacros(query: string): Macro[] {
  return MACROS.filter((m) => matchesMacroQuery(t(m.label), query));
}

// ------------------------------------------------------------------------------- recency

/** The part of `Storage` the recency list uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const RECENT_MACROS_KEY = "reqforge.editor.recentMacros";
export const MAX_RECENT_MACROS = 5;

/** `window.localStorage`, or null where reading it throws (sandboxed frames, some privacy modes). */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The recent macros, most recent first. Anything unreadable is treated as no history. */
export function loadRecentMacros(storage: StorageLike | null): MacroId[] {
  if (!storage) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(RECENT_MACROS_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const ids = parsed.filter((v): v is MacroId => isMacroId(v) && isMacroAvailable(v));
  return [...new Set(ids)].slice(0, MAX_RECENT_MACROS);
}

/** Records an inserted macro as the most recent; returns the new list. Never throws. */
export function recordRecentMacro(storage: StorageLike | null, id: MacroId): MacroId[] {
  if (!isMacroAvailable(id)) return loadRecentMacros(storage);
  const next = [id, ...loadRecentMacros(storage).filter((r) => r !== id)].slice(0, MAX_RECENT_MACROS);
  if (storage) {
    try {
      storage.setItem(RECENT_MACROS_KEY, JSON.stringify(next));
    } catch {
      // A full or forbidden storage only costs the ordering.
    }
  }
  return next;
}
