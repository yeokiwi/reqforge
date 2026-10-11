// The macro catalogue behind the `{` Macro suggestions list, the `+ ▾` menu and the macro browser
// (10 §5.4–5.5): the drawn order, the statuses, filtering by name, and the recency order kept per
// browser — which must survive a localStorage that throws, holds junk, or is missing.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MACROS,
  MAX_RECENT_MACROS,
  RECENT_MACROS_KEY,
  type StorageLike,
  browserMacros,
  browserStorage,
  isMacroAvailable,
  loadRecentMacros,
  macroSuggestions,
  matchesMacroQuery,
  orderByRecency,
  recordRecentMacro,
} from "../macros";
import { INSERT_MENU, isInsertItemAvailable } from "../insert-menu-items";
import { t } from "@/copy";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? (data[key] as string) : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const throwing: StorageLike = {
  getItem: () => {
    throw new DOMException("denied", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("full", "QuotaExceededError");
  },
};

const labels = (query: string, recents: readonly string[] = []) => macroSuggestions(query, recents).map((i) => i.label);

describe("`{` Macro suggestions (10 §5.4)", () => {
  it("lists, in the drawn order, Info · Status · Gallery · Table of Contents · Requirement · Open macro browser", () => {
    expect(labels("")).toEqual(["Info", "Status", "Gallery", "Table of Contents", "Requirement", "Open macro browser"]);
    expect(t("autocomplete.title")).toBe("Macro suggestions");
  });

  it("draws Gallery (later) and Requirement (slice 2) disabled, the rest enabled", () => {
    const disabled = Object.fromEntries(macroSuggestions("").map((i) => [i.label, i.disabled]));
    expect(disabled).toEqual({
      Info: false,
      Status: false,
      Gallery: true,
      "Table of Contents": false,
      Requirement: true,
      "Open macro browser": false,
    });
  });

  it("filters by the start of the name or of any word, case-insensitively, keeping the browser entry", () => {
    expect(labels("req")).toEqual(["Requirement", "Open macro browser"]);
    expect(labels("REQ")).toEqual(["Requirement", "Open macro browser"]);
    expect(labels("con")).toEqual(["Table of Contents", "Open macro browser"]);
    expect(labels("table of")).toEqual(["Table of Contents", "Open macro browser"]);
    expect(labels("st")).toEqual(["Status", "Open macro browser"]);
    expect(labels("open")).toEqual(["Open macro browser"]);
    expect(labels("macro")).toEqual(["Open macro browser"]);
  });

  it("is empty when nothing matches, so a brace in prose is left alone", () => {
    expect(macroSuggestions("a, b}")).toEqual([]);
    expect(macroSuggestions("zzz")).toEqual([]);
  });

  it("puts the recently inserted macros first, most recent first, and keeps the rest in the drawn order", () => {
    expect(labels("", ["toc", "status"])).toEqual(["Table of Contents", "Status", "Info", "Gallery", "Requirement", "Open macro browser"]);
    expect(labels("", ["status", "status", "nonsense"])).toEqual(["Status", "Info", "Gallery", "Table of Contents", "Requirement", "Open macro browser"]);
  });

  it("orderByRecency ignores unknown ids and duplicates", () => {
    expect(orderByRecency(["a", "b", "c"] as const, ["c", "x", "c", "a"])).toEqual(["c", "a", "b"]);
    expect(orderByRecency(["a", "b"] as const, [])).toEqual(["a", "b"]);
  });

  it("matchesMacroQuery: an empty or blank query matches everything", () => {
    expect(matchesMacroQuery("Info", "")).toBe(true);
    expect(matchesMacroQuery("Info", "   ")).toBe(true);
    expect(matchesMacroQuery("Table of Contents", "of")).toBe(true);
    expect(matchesMacroQuery("Table of Contents", "ble")).toBe(false);
  });
});

describe("recency, per browser (10 §5.4)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("records an inserted macro, most recent first, de-duplicated, at most five", () => {
    const storage = memoryStorage();
    recordRecentMacro(storage, "info");
    recordRecentMacro(storage, "status");
    expect(recordRecentMacro(storage, "info")).toEqual(["info", "status"]);
    expect(loadRecentMacros(storage)).toEqual(["info", "status"]);
    expect(JSON.parse(storage.data[RECENT_MACROS_KEY] as string)).toEqual(["info", "status"]);
    expect(MAX_RECENT_MACROS).toBe(5);
  });

  it("never records a macro that cannot be inserted", () => {
    const storage = memoryStorage();
    expect(recordRecentMacro(storage, "requirement")).toEqual([]);
    expect(recordRecentMacro(storage, "gallery")).toEqual([]);
    expect(storage.data[RECENT_MACROS_KEY]).toBeUndefined();
  });

  it("treats junk in storage as no history", () => {
    for (const junk of ["not json", "{}", '"info"', "null", '[1, null, "nope", "requirement"]']) {
      expect(loadRecentMacros(memoryStorage({ [RECENT_MACROS_KEY]: junk }))).toEqual([]);
    }
    expect(loadRecentMacros(memoryStorage({ [RECENT_MACROS_KEY]: '["toc", 7, "toc", "info"]' }))).toEqual(["toc", "info"]);
  });

  it("works when storage throws on read and on write: the list keeps its drawn order", () => {
    expect(loadRecentMacros(throwing)).toEqual([]);
    expect(recordRecentMacro(throwing, "status")).toEqual(["status"]);
    expect(labels("", loadRecentMacros(throwing))).toEqual(["Info", "Status", "Gallery", "Table of Contents", "Requirement", "Open macro browser"]);
  });

  it("works when there is no storage at all, or reading window.localStorage itself throws", () => {
    expect(loadRecentMacros(null)).toEqual([]);
    expect(recordRecentMacro(null, "info")).toEqual(["info"]);
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new DOMException("sandboxed", "SecurityError");
      },
    });
    expect(browserStorage()).toBeNull();
  });
});

describe("the macro browser's catalogue (10 §5.5)", () => {
  it("lists every macro, Requirement report, Traceability matrix and Baseline included, all of them disabled but Info, Status and Table of Contents", () => {
    expect(MACROS.map((m) => t(m.label))).toEqual([
      "Info",
      "Status",
      "Gallery",
      "Table of Contents",
      "Requirement",
      "Requirement report",
      "Traceability matrix",
      "Baseline",
      t("editor.insert.externalIssue"),
    ]);
    expect(MACROS.filter((m) => isMacroAvailable(m.id)).map((m) => m.id)).toEqual(["info", "status", "toc"]);
    expect(MACROS.find((m) => m.id === "requirement")?.availability).toBe("slice2");
  });

  it("filters by name", () => {
    expect(browserMacros("trace").map((m) => m.id)).toEqual(["traceabilityMatrix"]);
    expect(browserMacros("requirement").map((m) => m.id)).toEqual(["requirement", "requirementReport"]);
    expect(browserMacros("nothing")).toEqual([]);
  });
});

describe("the `+ ▾` Insert More Content menu (10 §5.5)", () => {
  it("has every item in the drawn order, the video's Jira item relabelled generically (RD-031)", () => {
    expect(INSERT_MENU.map((item) => t(item.label))).toEqual([
      "Files and images",
      "Link",
      "Markup",
      "Horizontal rule",
      "Task list",
      "Date",
      "Symbol",
      "User mention",
      t("editor.insert.externalIssue"),
      "Info",
      "Status",
      "Gallery",
      "Table of Contents",
      "Requirement",
      "Other macros",
    ]);
    expect(t("editor.insert.externalIssue")).not.toMatch(/jira/i);
  });

  it("disables exactly External issue and Gallery (later) and Requirement (slice 2)", () => {
    expect(INSERT_MENU.filter((item) => !isInsertItemAvailable(item)).map((item) => item.id)).toEqual(["externalIssue", "gallery", "requirement"]);
  });

  it("draws Other macros after a separator, and only it", () => {
    expect(INSERT_MENU.filter((item) => item.separated).map((item) => item.id)).toEqual(["otherMacros"]);
  });
});
