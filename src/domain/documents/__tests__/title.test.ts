import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  LIMITS,
  UNTITLED_TITLE,
  checkTitle,
  codePointLength,
  copyTitle,
  normalizeTitle,
  suggestUniqueTitle,
  titleKey,
} from "@/domain/documents";

// RD-056: titles are 1–255 characters after trimming, no control characters, unique per
// space among live pages case-insensitively. Copy is `Copy of <title>`, made unique.

const CLUSTER = "👍"; // one astral code point, two UTF-16 units
const FAMILY = "👨‍👩‍👧"; // one grapheme, five code points

describe("normalizeTitle", () => {
  it("trims and composes to NFC", () => {
    expect(normalizeTitle("  Café \n")).toBe("Café");
    expect(normalizeTitle("Café")).toBe("Café");
  });

  it("is idempotent", () => {
    fc.assert(fc.property(fc.string({ unit: "binary" }), (s) => normalizeTitle(normalizeTitle(s)) === normalizeTitle(s)));
  });
});

describe("checkTitle", () => {
  it("accepts an ordinary title and returns it normalised", () => {
    expect(checkTitle("  Requirements overview ")).toEqual({ ok: true, title: "Requirements overview" });
    expect(checkTitle("Café")).toEqual({ ok: true, title: "Café" });
  });

  it.each([
    ["the empty string", ""],
    ["spaces", "   "],
    ["tabs and newlines", "\t\n\r\n"],
    ["no-break and ideographic spaces", " 　"],
  ])("refuses %s as EMPTY", (_label, raw) => {
    expect(checkTitle(raw)).toEqual({ ok: false, problem: "EMPTY" });
  });

  it("accepts exactly 255 code points and refuses 256", () => {
    expect(checkTitle("a".repeat(255))).toEqual({ ok: true, title: "a".repeat(255) });
    expect(checkTitle("a".repeat(256))).toEqual({ ok: false, problem: "TOO_LONG" });
  });

  it("measures after trimming, so surrounding whitespace does not count", () => {
    expect(checkTitle(`  ${"a".repeat(255)}  `).ok).toBe(true);
  });

  it("counts an astral character once, not as two UTF-16 units", () => {
    const title = CLUSTER.repeat(255);
    expect(title.length).toBe(510);
    expect(checkTitle(title)).toEqual({ ok: true, title });
    expect(checkTitle(CLUSTER.repeat(256))).toEqual({ ok: false, problem: "TOO_LONG" });
  });

  it("counts after NFC, so a decomposed accent is one character", () => {
    const decomposed = "é".repeat(255); // 510 code points, 255 after NFC
    expect(checkTitle(decomposed)).toEqual({ ok: true, title: "é".repeat(255) });
  });

  it.each([
    ["a tab", "Plan\tA"],
    ["a newline", "Plan\nA"],
    ["a carriage return", "Plan\rA"],
    ["NUL", "Plan\u0000A"],
    ["DEL", "Plan\u007fA"],
    ["a C1 control", "Plan\u0085A"],
    ["a line separator", "Plan A"],
    ["a paragraph separator", "Plan A"],
    ["a lone surrogate", "Plan\ud800A"],
  ])("refuses %s inside the title", (_label, raw) => {
    expect(checkTitle(raw)).toEqual({ ok: false, problem: "CONTROL_CHARACTERS" });
  });

  it("reports CONTROL_CHARACTERS before TOO_LONG when a title has both", () => {
    // The order EMPTY, CONTROL_CHARACTERS, TOO_LONG; EMPTY excludes both others, so only this
    // pair can be told apart.
    const raw = `${"a".repeat(300)}\tb`;
    expect(codePointLength(normalizeTitle(raw))).toBeGreaterThan(LIMITS.titleMax);
    expect(checkTitle(raw)).toEqual({ ok: false, problem: "CONTROL_CHARACTERS" });
  });

  it("trims a pasted trailing newline instead of refusing it", () => {
    expect(checkTitle("Plan A\n")).toEqual({ ok: true, title: "Plan A" });
  });

  it("accepts any script, symbols and slashes", () => {
    for (const t of ["日本語の文字", "حروف عربية", "REQ-004(§2.5)", "Design / Build", FAMILY]) {
      expect(checkTitle(t)).toEqual({ ok: true, title: t });
    }
  });
});

describe("titleKey", () => {
  it("is case-insensitive and normalisation-insensitive", () => {
    expect(titleKey("Overview")).toBe(titleKey("OVERVIEW"));
    expect(titleKey("Café")).toBe(titleKey("CAFÉ"));
    expect(titleKey("  Overview ")).toBe(titleKey("overview"));
  });

  it("keeps different titles apart", () => {
    expect(titleKey("Overview")).not.toBe(titleKey("Overview 2"));
  });
});

describe("suggestUniqueTitle", () => {
  it("gives the base when it is free", () => {
    expect(suggestUniqueTitle("Untitled", [])).toBe("Untitled");
    expect(suggestUniqueTitle("Untitled", ["Something else"])).toBe("Untitled");
  });

  it("numbers from 2, skipping every taken title case-insensitively", () => {
    expect(suggestUniqueTitle("Untitled", ["Untitled"])).toBe("Untitled 2");
    expect(suggestUniqueTitle("Untitled", ["UNTITLED", "untitled 2", "Untitled 4"])).toBe("Untitled 3");
    expect(suggestUniqueTitle("Untitled", ["untitled", "UNTITLED 2", "Untitled 3"])).toBe("Untitled 4");
  });

  it("treats a taken title with stray whitespace or another normal form as taken", () => {
    expect(suggestUniqueTitle("Café", ["  CAFÉ  "])).toBe("Café 2");
  });

  it("does not stop at a gap the caller did not ask about", () => {
    expect(suggestUniqueTitle("Untitled", ["Untitled 2"])).toBe("Untitled");
  });

  it("truncates the base, not the number, to stay within 255", () => {
    const base = "b".repeat(255);
    expect(suggestUniqueTitle(base, [])).toBe(base);
    const second = suggestUniqueTitle(base, [base]);
    expect(second).toBe(`${"b".repeat(253)} 2`);
    expect(codePointLength(second)).toBe(255);
    const tenth = suggestUniqueTitle(base, [base, ...Array.from({ length: 8 }, (_, i) => `${"b".repeat(253)} ${i + 2}`)]);
    expect(tenth).toBe(`${"b".repeat(252)} 10`);
  });

  it("truncates an over-long base even when it is free", () => {
    expect(suggestUniqueTitle("c".repeat(300), [])).toBe("c".repeat(255));
  });

  it("never splits a grapheme when truncating", () => {
    const base = "a".repeat(250) + FAMILY; // 255 code points
    expect(suggestUniqueTitle(base, [])).toBe(base);
    expect(suggestUniqueTitle(base, [base])).toBe(`${"a".repeat(250)} 2`);
  });

  it("drops a trailing space exposed by truncation rather than doubling it", () => {
    const base = `${"d".repeat(252)} xyz`; // 256 code points
    expect(suggestUniqueTitle(base, [`${"d".repeat(252)} xy`])).toBe(`${"d".repeat(252)} 2`);
  });

  it("falls back to Untitled for an empty base and replaces control characters", () => {
    expect(suggestUniqueTitle("   ", [])).toBe(UNTITLED_TITLE);
    expect(suggestUniqueTitle("Plan\tA", [])).toBe("Plan A");
  });
});

describe("copyTitle", () => {
  it("prefixes Copy of, then numbers", () => {
    expect(copyTitle("Overview", ["Overview"])).toBe("Copy of Overview");
    expect(copyTitle("Overview", ["Overview", "copy of overview"])).toBe("Copy of Overview 2");
    expect(copyTitle("Overview", ["Copy of Overview", "COPY OF OVERVIEW 2"])).toBe("Copy of Overview 3");
  });

  it("truncates the original title, keeping the wording and the number", () => {
    const original = "o".repeat(255);
    const first = copyTitle(original, [original]);
    expect(first).toBe(`Copy of ${"o".repeat(247)}`);
    expect(codePointLength(first)).toBe(255);
    expect(copyTitle(original, [original, first])).toBe(`Copy of ${"o".repeat(245)} 2`);
  });

  it("accepts the wording from the caller, e.g. the copy deck", () => {
    expect(copyTitle("Overview", [], (t) => `${t} (copy)`)).toBe("Overview (copy)");
    const long = copyTitle("o".repeat(255), [], (t) => `${t} (copy)`);
    expect(long.endsWith(" (copy)")).toBe(true);
    expect(codePointLength(long)).toBe(255);
  });
});

// ---- properties ---------------------------------------------------------------------------

const anyTitle = fc.oneof(
  fc.string({ unit: "grapheme", maxLength: 40 }),
  fc.string({ unit: "binary", maxLength: 40 }),
  fc.string({ unit: "grapheme-ascii", minLength: 240, maxLength: 300 }),
  fc.string({ unit: "grapheme", minLength: 120, maxLength: 300 }),
  fc.constantFrom("Untitled", "untitled", "Copy of Untitled", " ", ""),
);

/** Some of the titles the function would itself produce, in random case. */
function takenNear(base: string, generate: (taken: string[]) => string) {
  return fc
    .array(fc.tuple(fc.boolean(), fc.constantFrom("lower", "upper", "same")), { maxLength: 12 })
    .map((plan) => {
      const taken: string[] = [];
      const own: string[] = [];
      for (const [keep, caseMode] of plan) {
        const next = generate(own);
        own.push(next);
        if (keep) taken.push(caseMode === "lower" ? next.toLowerCase() : caseMode === "upper" ? next.toUpperCase() : next);
      }
      return { base, taken };
    });
}

const unique = (taken: readonly string[], t: string) => !taken.some((x) => titleKey(x) === titleKey(t));

describe("properties", () => {
  it("suggestUniqueTitle never returns a taken title, never exceeds the limit, and always passes checkTitle", () => {
    fc.assert(
      fc.property(
        anyTitle.chain((base) => takenNear(base, (own) => suggestUniqueTitle(base, own))),
        fc.array(anyTitle, { maxLength: 5 }),
        ({ base, taken }, noise) => {
          const all = [...taken, ...noise];
          const t = suggestUniqueTitle(base, all);
          expect(unique(all, t)).toBe(true);
          expect(codePointLength(t)).toBeLessThanOrEqual(LIMITS.titleMax);
          expect(checkTitle(t)).toEqual({ ok: true, title: t });
        },
      ),
      { numRuns: 300 },
    );
  });

  it("copyTitle never returns a taken title, never exceeds the limit, and always passes checkTitle", () => {
    fc.assert(
      fc.property(
        anyTitle.chain((original) => takenNear(original, (own) => copyTitle(original, own))),
        ({ base, taken }) => {
          const t = copyTitle(base, taken);
          expect(unique(taken, t)).toBe(true);
          expect(codePointLength(t)).toBeLessThanOrEqual(LIMITS.titleMax);
          expect(checkTitle(t)).toEqual({ ok: true, title: t });
          expect(t.startsWith("Copy of")).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("creating pages one after another yields pairwise-distinct titles", () => {
    fc.assert(
      fc.property(anyTitle, fc.integer({ min: 1, max: 30 }), (base, count) => {
        const made: string[] = [];
        for (let i = 0; i < count; i++) made.push(suggestUniqueTitle(base, made));
        expect(new Set(made.map(titleKey)).size).toBe(count);
      }),
      { numRuns: 100 },
    );
  });

  it("checkTitle accepts exactly the titles of 1..255 code points without controls", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 300 }), (raw) => {
        const result = checkTitle(raw);
        const n = normalizeTitle(raw);
        if (result.ok) {
          expect(result.title).toBe(n);
          expect(codePointLength(n)).toBeGreaterThanOrEqual(1);
          expect(codePointLength(n)).toBeLessThanOrEqual(255);
          expect(/[\p{Cc}\p{Zl}\p{Zp}\p{Cs}]/u.test(n)).toBe(false);
        } else if (n === "") {
          expect(result.problem).toBe("EMPTY");
        }
      }),
      { numRuns: 300 },
    );
  });
});
