// Find and replace (RD-057 `🔍`), headless: the match computation is pure, and the plugin is run
// in a plain EditorState with ProseMirror's own history, so undo is the real undo. What it must
// guarantee: matches are where the text is (across marks, not across blocks or atoms), are
// non-overlapping, respect Match case, survive regex metacharacters; Replace and Replace all are
// undoable (Replace all in ONE step); a replacement can never make content the server refuses.
import type { Node as PMNode } from "@tiptap/pm/model";
import { history, redo, undo } from "@tiptap/pm/history";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { documentSchema, validateDocumentJson } from "@/editor/schema";
import {
  EMPTY_FIND_STATE,
  FIND_CURRENT_CLASS,
  FIND_MATCH_CLASS,
  MAX_FIND_MATCHES,
  cleanReplacement,
  clearFind,
  escapeRegExp,
  findCount,
  findKey,
  findMatches,
  findPlugin,
  findState,
  matchIndexFrom,
  moveFindMatch,
  replaceAllMatches,
  replaceCurrentMatch,
  setFindQuery,
} from "../find-replace";

type Json = Record<string, unknown>;
const t = (text: string, marks?: Json[]): Json => (marks ? { type: "text", text, marks } : { type: "text", text });
const para = (...content: Json[]): Json => (content.length ? { type: "paragraph", content } : { type: "paragraph" });
const docOf = (...content: Json[]): PMNode => documentSchema.nodeFromJSON({ type: "doc", content });

/** The matched strings, in order. */
function matched(doc: PMNode, query: string, caseSensitive = false): string[] {
  return findMatches(doc, query, caseSensitive).matches.map((m) => doc.textBetween(m.from, m.to));
}

/** A state with the find plugin and real history; `run` dispatches into it. */
function session(doc: PMNode) {
  let state = EditorState.create({ schema: documentSchema, doc, plugins: [history(), findPlugin()] });
  const dispatch = (tr: Transaction) => {
    state = state.apply(tr);
  };
  return {
    get state() {
      return state;
    },
    dispatch,
    text: () => state.doc.textContent,
    undo: () => undo(state, dispatch),
    redo: () => redo(state, dispatch),
  };
}

describe("findMatches", () => {
  it("finds every occurrence, in document order, across paragraphs", () => {
    const doc = docOf(para(t("one two one")), para(t("one")));
    expect(matched(doc, "one")).toEqual(["one", "one", "one"]);
    expect(findMatches(doc, "one", false).matches[0]).toEqual({ from: 1, to: 4 });
  });

  it("is case-insensitive by default and case-sensitive with Match case", () => {
    const doc = docOf(para(t("Alpha alpha ALPHA")));
    expect(matched(doc, "alpha")).toEqual(["Alpha", "alpha", "ALPHA"]);
    expect(matched(doc, "alpha", true)).toEqual(["alpha"]);
    expect(matched(doc, "ALPHA", true)).toEqual(["ALPHA"]);
  });

  it("folds case beyond ASCII and keeps offsets right after astral characters", () => {
    const doc = docOf(para(t("😀Äpfel ÄPFEL äpfel")));
    expect(matched(doc, "äpfel")).toEqual(["Äpfel", "ÄPFEL", "äpfel"]);
    expect(matched(doc, "äpfel", true)).toEqual(["äpfel"]);
  });

  it("does not overlap: matches resume after each match, as Replace all consumes them", () => {
    expect(matched(docOf(para(t("aaaa"))), "aa")).toEqual(["aa", "aa"]);
    expect(findMatches(docOf(para(t("aaa"))), "aa", false).matches).toEqual([{ from: 1, to: 3 }]);
    expect(matched(docOf(para(t("abababa"))), "aba")).toEqual(["aba", "aba"]);
  });

  it("matches across mark boundaries", () => {
    const doc = docOf(para(t("he"), t("llo", [{ type: "bold" }]), t(" world")));
    expect(matched(doc, "hello")).toEqual(["hello"]);
  });

  it("never matches across two blocks, nor through an inline atom or a line break", () => {
    expect(matched(docOf(para(t("hel")), para(t("lo"))), "hello")).toEqual([]);
    const withAtom = docOf(para(t("hel"), { type: "status", attrs: { text: "X", colour: "grey" } }, t("lo")));
    expect(matched(withAtom, "hello")).toEqual([]);
    expect(matched(withAtom, "lo")).toEqual(["lo"]);
    const withBreak = docOf(para(t("hel"), { type: "hardBreak" }, t("lo")));
    expect(matched(withBreak, "hel lo")).toEqual([]);
    expect(matched(withBreak, "hello")).toEqual([]);
  });

  it("puts matches after an atom at the right positions", () => {
    const doc = docOf(para({ type: "mention", attrs: { userId: "u1", label: "Ann" } }, t(" key")));
    const [m] = findMatches(doc, "key", false).matches;
    expect(m && doc.textBetween(m.from, m.to)).toBe("key");
  });

  it("finds a requirement-style key with a hyphen, and every RegExp metacharacter literally", () => {
    const doc = docOf(para(t("REQ-001 (a+b)*c? [x] {y} ^$ a|b a.b a/b back\\slash")));
    for (const q of ["REQ-001", "(a+b)*c?", "[x]", "{y}", "^$", "a|b", "a.b", "a/b", "back\\slash"]) {
      expect(matched(doc, q), q).toEqual([q]);
    }
    expect(matched(doc, ".")).toEqual(["."]);
  });

  it("escapeRegExp produces a valid unicode-mode pattern for any input", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 20 }), (s) => {
        expect(() => new RegExp(escapeRegExp(s), "giu")).not.toThrow();
        expect(new RegExp(`^${escapeRegExp(s)}$`, "u").test(s)).toBe(true);
      }),
    );
  });

  it("finds in headings, code blocks, table cells and list items", () => {
    const doc = documentSchema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [t("key here")] },
        { type: "codeBlock", content: [t("let key = 1")] },
        { type: "bulletList", content: [{ type: "listItem", content: [para(t("a key"))] }] },
        {
          type: "table",
          content: [{ type: "tableRow", content: [{ type: "tableCell", content: [para(t("key"))] }] }],
        },
      ],
    });
    expect(matched(doc, "key")).toHaveLength(4);
  });

  it("an empty query, or one made only of the atom placeholder, finds nothing", () => {
    const doc = docOf(para(t("abc")));
    expect(findMatches(doc, "", false)).toEqual({ matches: [], capped: false });
    expect(findMatches(doc, "￼", false)).toEqual({ matches: [], capped: false });
  });

  it("stops at the cap and says so", () => {
    const doc = docOf(para(t("x".repeat(30))));
    const result = findMatches(doc, "x", false, 10);
    expect(result.matches).toHaveLength(10);
    expect(result.capped).toBe(true);
    expect(MAX_FIND_MATCHES).toBe(10_000);
  });

  it("matchIndexFrom: the first match at or after a position, wrapping to the first", () => {
    const matches = [
      { from: 5, to: 6 },
      { from: 10, to: 11 },
    ];
    expect(matchIndexFrom(matches, 0)).toBe(0);
    expect(matchIndexFrom(matches, 6)).toBe(1);
    expect(matchIndexFrom(matches, 11)).toBe(0);
    expect(matchIndexFrom([], 3)).toBe(-1);
  });
});

describe("the find plugin", () => {
  it("searches from the selection, selects the current match, and decorates every match", () => {
    const s = session(docOf(para(t("cat dog cat dog"))));
    setFindQuery(s.state, s.dispatch, "dog", false);
    const find = findState(s.state);
    expect(find.matches).toHaveLength(2);
    expect(find.current).toBe(0);
    expect(s.state.doc.textBetween(s.state.selection.from, s.state.selection.to)).toBe("dog");
    const decorations = findKey.get(s.state)?.props.decorations?.call(findKey.get(s.state) as never, s.state);
    // An inline decoration's attributes are on its (internal) type; read them for the test.
    const specs = (decorations as unknown as { find(): { type: { attrs: { class: string } } }[] }).find().map((d) => d.type.attrs.class);
    expect(specs).toEqual([`${FIND_MATCH_CLASS} ${FIND_CURRENT_CLASS}`, FIND_MATCH_CLASS]);
  });

  it("next and previous wrap around", () => {
    const s = session(docOf(para(t("a b a b a"))));
    setFindQuery(s.state, s.dispatch, "a", false);
    expect(findState(s.state).current).toBe(0);
    moveFindMatch(s.state, s.dispatch, -1);
    expect(findState(s.state).current).toBe(2);
    moveFindMatch(s.state, s.dispatch, 1);
    expect(findState(s.state).current).toBe(0);
    expect(moveFindMatch(session(docOf(para(t("x")))).state, () => undefined, 1)).toBe(false);
  });

  it("searching is not an undo step", () => {
    const s = session(docOf(para(t("abc"))));
    setFindQuery(s.state, s.dispatch, "b", false);
    expect(s.undo()).toBe(false);
  });

  it("follows edits made while it is open, and clears", () => {
    const s = session(docOf(para(t("one"))));
    setFindQuery(s.state, s.dispatch, "one", false);
    s.dispatch(s.state.tr.insertText(" one", s.state.doc.content.size - 1));
    expect(findState(s.state).matches).toHaveLength(2);
    clearFind(s.state, s.dispatch);
    expect(findState(s.state)).toEqual(EMPTY_FIND_STATE);
  });

  it("counts: `n of m`, capped, none, and nothing for an empty query", () => {
    expect(findCount(EMPTY_FIND_STATE)).toBeNull();
    expect(findCount({ ...EMPTY_FIND_STATE, query: "x" })).toEqual({ kind: "none" });
    expect(findCount({ query: "x", caseSensitive: false, matches: [{ from: 1, to: 2 }, { from: 3, to: 4 }], capped: false, current: 1 })).toEqual({
      kind: "count",
      current: 2,
      total: 2,
    });
    expect(findCount({ query: "x", caseSensitive: false, matches: [{ from: 1, to: 2 }], capped: true, current: 0 })).toEqual({ kind: "capped", current: 1, total: 1 });
  });
});

describe("replace", () => {
  it("replaces the current match, keeps its marks, moves on, and is undoable", () => {
    const s = session(docOf(para(t("x "), t("old", [{ type: "bold" }]), t(" old"))));
    setFindQuery(s.state, s.dispatch, "old", false);
    replaceCurrentMatch(s.state, s.dispatch, "new");
    expect(s.text()).toBe("x new old");
    const first = s.state.doc.firstChild?.child(1);
    expect(first?.text).toBe("new");
    expect(first?.marks.map((m) => m.type.name)).toEqual(["bold"]);
    expect(s.state.doc.textBetween(s.state.selection.from, s.state.selection.to)).toBe("old");
    expect(findState(s.state).matches).toHaveLength(1);
    s.undo();
    expect(s.text()).toBe("x old old");
  });

  it("Replace all is ONE undo step, and redo brings it back", () => {
    const s = session(docOf(para(t("a-1 a-1")), para(t("A-1"))));
    setFindQuery(s.state, s.dispatch, "a-1", false);
    let dispatches = 0;
    expect(
      replaceAllMatches(s.state, (tr) => {
        dispatches += 1;
        s.dispatch(tr);
      }, "B-2"),
    ).toBe(3);
    expect(dispatches).toBe(1); // one transaction, not three grouped by history's timing
    expect(s.text()).toBe("B-2 B-2B-2");
    expect(s.undo()).toBe(true);
    expect(s.text()).toBe("a-1 a-1A-1");
    expect(s.redo()).toBe(true);
    expect(s.text()).toBe("B-2 B-2B-2");
  });

  it("an empty replacement deletes the matches", () => {
    const s = session(docOf(para(t("keep drop keep drop"))));
    setFindQuery(s.state, s.dispatch, " drop", false);
    replaceAllMatches(s.state, s.dispatch, "");
    expect(s.text()).toBe("keep keep");
  });

  it("a replacement that contains the query does not loop", () => {
    const s = session(docOf(para(t("a a"))));
    setFindQuery(s.state, s.dispatch, "a", false);
    expect(replaceAllMatches(s.state, s.dispatch, "aa")).toBe(2);
    expect(s.text()).toBe("aa aa");
  });

  it("never writes what the server refuses: U+0000, half an emoji and line breaks are cleaned (RD-068)", () => {
    expect(cleanReplacement("a\u0000b\uD83Dc\nd\r\ne f")).toBe("abc d e f");
    const s = session(docOf(para(t("x x"))));
    setFindQuery(s.state, s.dispatch, "x", false);
    replaceAllMatches(s.state, s.dispatch, "y\u0000\uDE00\nz");
    expect(s.text()).toBe("y z y z");
    expect(validateDocumentJson(s.state.doc.toJSON()).ok).toBe(true);
  });

  it("replacing in a code block and a link keeps the document valid", () => {
    const doc = documentSchema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "codeBlock", attrs: { language: "ts" }, content: [t("const old = 1")] },
        para(t("old", [{ type: "link", attrs: { href: "https://example.com" } }])),
      ],
    });
    const s = session(doc);
    setFindQuery(s.state, s.dispatch, "old", false);
    replaceAllMatches(s.state, s.dispatch, "new");
    expect(s.text()).toBe("const new = 1new");
    expect(validateDocumentJson(s.state.doc.toJSON()).ok).toBe(true);
    expect(JSON.stringify(s.state.doc.toJSON())).toContain('"href":"https://example.com"');
  });

  it("property: replace-all then undo restores any document exactly, and the result always validates", () => {
    const word = fc.constantFrom("ab", "a", "b", "AB", "x", " ", "a-b", "😀");
    fc.assert(
      fc.property(fc.array(fc.array(word, { minLength: 1, maxLength: 8 }), { minLength: 1, maxLength: 4 }), word, fc.string({ maxLength: 4 }), fc.boolean(), (paras, query, replacement, caseSensitive) => {
        const doc = docOf(...paras.map((ws) => para(t(ws.join("")))));
        const s = session(doc);
        setFindQuery(s.state, s.dispatch, query, caseSensitive);
        const n = replaceAllMatches(s.state, s.dispatch, replacement);
        expect(validateDocumentJson(s.state.doc.toJSON()).ok).toBe(true);
        if (n > 0) {
          s.undo();
          expect(s.state.doc.eq(doc)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});
