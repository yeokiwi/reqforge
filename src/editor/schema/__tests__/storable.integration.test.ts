// RD-063: validated content is what gets stored. Content lives in a Postgres `jsonb` column,
// and jsonb is stricter than JavaScript strings: it refuses `\u0000` and unpaired UTF-16
// surrogates. So whatever validateDocumentJson accepts, Postgres must accept too, and give
// back unchanged. Every string here is tried in each free-text position of the schema.
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { validateDocumentJson } from "..";
import { ATTACHMENT_ID, IMAGE_SRC, USER_ID, doc, p, text } from "./fixtures";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

const STRINGS: ReadonlyArray<readonly [string, string]> = [
  ["U+0000", "a\u0000b"],
  ["a lone high surrogate", "a\ud83db"],
  ["a lone low surrogate", "a\ude42b"],
  ["a trailing high surrogate", "ab\ud83d"],
  ["a pair written low then high", "\ude42\ud83d"],
  ["a surrogate pair", "a🙂b"],
  ["the last code point", "􏿿"],
  ["other C0 controls", "a\u0001\u001fb"],
  ["noncharacters", "a￾￿b"],
  ["the six characters \\u0000", "a\\u0000b"],
  ["CJK", "日本語の文字-001"],
];

const PLACES: ReadonlyArray<readonly [string, (s: string) => unknown]> = [
  ["text", (s) => doc(p(text(s)))],
  ["a mention label", (s) => doc(p({ type: "mention", attrs: { userId: USER_ID, label: `L${s}` } }))],
  ["a link href", (s) => doc(p(text("x", [{ type: "link", attrs: { href: `/a${s}` } }])))],
  ["an image alt and title", (s) => doc(p({ type: "image", attrs: { attachmentId: ATTACHMENT_ID, src: IMAGE_SRC, alt: s, title: s } }))],
  ["status text", (s) => doc(p({ type: "status", attrs: { text: `S${s}`, colour: "green" } }))],
];

async function roundTrip(json: string): Promise<unknown> {
  const rows = await prisma.$queryRaw<Array<{ v: unknown }>>`SELECT ${json}::jsonb AS v`;
  return rows[0]?.v;
}

describe("validateDocumentJson accepts only what Postgres jsonb stores (RD-063)", () => {
  it.each(PLACES)("in %s", async (_place, build) => {
    let accepted = 0;
    for (const [label, s] of STRINGS) {
      const result = validateDocumentJson(build(s));
      if (!result.ok) continue;
      accepted += 1;
      const stored = await roundTrip(JSON.stringify(result.doc)).catch((error: unknown) => {
        throw new Error(`validated, but Postgres refused ${label}: ${error instanceof Error ? error.message : String(error)}`);
      });
      expect(stored, label).toEqual(result.doc);
    }
    // Not vacuous: the well-formed strings are accepted in every place.
    expect(accepted).toBeGreaterThanOrEqual(4);
  });

  it("Postgres does refuse the strings the validator refuses (the premise of the rule)", async () => {
    await expect(roundTrip(JSON.stringify({ t: "a\u0000b" }))).rejects.toThrow();
    await expect(roundTrip(JSON.stringify({ t: "a\ud83db" }))).rejects.toThrow();
    await expect(roundTrip(JSON.stringify({ t: "a\ude42b" }))).rejects.toThrow();
  });
});
