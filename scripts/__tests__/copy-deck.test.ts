import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CopyDeckParseError, parseCopyDeck, renderDeckModule } from "../copy-deck/parse";

const SPEC = readFileSync("docs/specs/10-ui-reference.md", "utf8");
const wrap = (rows: string) =>
  ["## 12. Elsewhere", "| `ignored` | ignored |", "## 13. Copy deck", "| Id | String |", "|---|---|", rows, "## 14. Next"].join(
    "\n",
  );

describe("parseCopyDeck — rows", () => {
  it("reads a single id and string", () => {
    expect(parseCopyDeck(wrap("| `editor.update` | Update |"))).toEqual({ "editor.update": "Update" });
  });

  it("ignores tables outside §13", () => {
    expect(parseCopyDeck(wrap("| `a.b` | A |"))).not.toHaveProperty("ignored");
  });

  it("strips a trailing italic note", () => {
    const deck = parseCopyDeck(wrap("| `a.b` | Hello there. *(ours — §10)* |"));
    expect(deck["a.b"]).toBe("Hello there.");
  });

  it("strips a note that contains backticks and a dash", () => {
    const deck = parseCopyDeck(wrap("| `a.b` | Ignore errors *(video: \"x\" — removed, `RD-031`)* |"));
    expect(deck["a.b"]).toBe("Ignore errors");
  });

  it("keeps parentheses that are part of the string", () => {
    expect(parseCopyDeck(wrap("| `d.limit` | Limit ({n}) |"))["d.limit"]).toBe("Limit ({n})");
  });

  it("splits several ids against several strings", () => {
    const deck = parseCopyDeck(wrap("| `page.edit` / `page.share` | Edit / Share |"));
    expect(deck).toEqual({ "page.edit": "Edit", "page.share": "Share" });
  });

  it("resolves a leading dot against the previous id", () => {
    const deck = parseCopyDeck(wrap("| `baselines.col.id` / `.name` / `.count` | ID / Name / Count |"));
    expect(deck).toEqual({
      "baselines.col.id": "ID",
      "baselines.col.name": "Name",
      "baselines.col.count": "Count",
    });
  });

  it("keeps ' / ' inside a lone id's string", () => {
    expect(parseCopyDeck(wrap("| `baselines.pages` | {n} page / {n} pages |"))["baselines.pages"]).toBe(
      "{n} page / {n} pages",
    );
  });

  it("preserves leading quotes", () => {
    expect(parseCopyDeck(wrap('| `key.invalid` | "{key}" is not a valid key. |'))["key.invalid"]).toBe(
      '"{key}" is not a valid key.',
    );
  });
});

describe("parseCopyDeck — failures are loud", () => {
  const fails = (rows: string, message: RegExp) => {
    expect(() => parseCopyDeck(wrap(rows))).toThrow(CopyDeckParseError);
    expect(() => parseCopyDeck(wrap(rows))).toThrow(message);
  };

  it("rejects a count mismatch between ids and strings", () => {
    fails("| `a.x` / `a.y` | Only one |", /2 ids but 1 strings/);
  });
  it("rejects a duplicate id", () => {
    fails("| `a.x` | One |\n| `a.x` | Two |", /duplicate id a\.x/);
  });
  it("rejects a relative id with nothing before it", () => {
    fails("| `.x` | One |", /relative id/);
  });
  it("rejects an id cell that is not code", () => {
    fails("| a.x | One |", /unreadable id cell/);
  });
  it("rejects a row with extra cells", () => {
    fails("| `a.x` | One | Two |", /exactly two cells/);
  });
  it("rejects an empty string", () => {
    fails("| `a.x` | *(only a note)* |", /empty string for a\.x/);
  });
  it("rejects a document with no deck", () => {
    expect(() => parseCopyDeck("# nothing here")).toThrow(/no copy deck/);
  });
});

describe("the real spec (docs/specs/10-ui-reference.md §13)", () => {
  const deck = parseCopyDeck(SPEC);

  it("parses without error and is not trivially small", () => {
    expect(Object.keys(deck).length).toBeGreaterThan(250);
  });

  it("reproduces strings from the video verbatim", () => {
    expect(deck["editor.state.ready"]).toBe("Ready to go");
    expect(deck["editor.changeNote.placeholder"]).toBe("What did you change?");
    expect(deck["sidebar.matrices"]).toBe("TRACEABILITY MATRIXES");
    expect(deck["search.hint"]).toBe("[ Ctrl + Space ] for help, or lookup the search syntax.");
    expect(deck["restrictions.view.sub"]).toBe("Only some can view or edit");
    expect(deck["wizard.when.now"]).toBe("Freeze requirements now");
    expect(deck["wizard.page.none"]).toBe("None (simple)");
    expect(deck["rename.info"]).toBe("Reqforge modified {m} macros on {p} pages to rename {r} requirements.");
    expect(deck["metrics.note"]).toBe("We don't do telemetry, these metrics are just for you.");
  });

  it("carries the shell strings the top bar and sidebar render (10 §2–3)", () => {
    expect(deck["shell.spaces"]).toBe("Spaces");
    expect(deck["shell.create"]).toBe("Create");
    expect(deck["shell.spaces.viewAll"]).toBe("View all spaces");
    expect(deck["sidebar.shortcuts"]).toBe("SPACE SHORTCUTS");
    expect(deck["sidebar.pageTree"]).toBe("PAGE TREE");
    expect(deck["sidebar.spaceTools"]).toBe("Space tools");
  });

  it("names our product, never the vendor's (RD-031)", () => {
    const text = Object.values(deck).join("\n");
    expect(text).not.toMatch(/Requirement Yogi|Confluence|Atlassian/i);
    expect(text).not.toMatch(/\bJira\b/);
  });

  it("is in sync with the committed src/copy/deck.generated.ts — run `pnpm copy:gen`", () => {
    const committed = readFileSync("src/copy/deck.generated.ts", "utf8");
    expect(committed).toBe(renderDeckModule(deck));
  });
});
