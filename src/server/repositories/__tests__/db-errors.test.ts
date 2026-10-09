// mapDbError without a database: the exact error shapes Prisma 6 produced against PostgreSQL 16
// (captured from real refusals; see db-errors.integration.test.ts for the live versions). This
// keeps the "DETAIL is user content" rule under `pnpm verify`, which runs no integration tests.
// spec: docs/specs/08-api-surface.md section 3.2 (stable error codes)
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { CycleError, PinnedVersionError, TitleTakenError, ValidationError } from "@/domain/errors";
import { inspectDbError, mapDbError } from "@/server/repositories/db-errors";

const clientVersion = "6.19.3";

/** A $queryRaw / $executeRaw failure. `pg` is what PostgreSQL said, "ERROR: …\nDETAIL: …". */
function raw(sqlState: string, pg: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    `\nInvalid \`prisma.$executeRaw()\` invocation:\n\n\nRaw query failed. Code: \`${sqlState}\`. Message: \`${pg}\``,
    { code: "P2010", clientVersion, meta: { code: sqlState, message: pg } },
  );
}

/** Rust's `{:?}` of a string, as the query engine prints it. */
function debugString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/**
 * A failure under the ORM (trigger or CHECK): only the engine's debug print carries it.
 * `excerpt` stands for the call-site source lines Prisma's default errorFormat prints first.
 */
function orm(sqlState: string, message: string, detail: string | null, excerpt = ""): Prisma.PrismaClientUnknownRequestError {
  const detailText = detail === null ? "None" : `Some(${debugString(detail)})`;
  return new Prisma.PrismaClientUnknownRequestError(
    `\nInvalid \`prisma.documentDraft.upsert()\` invocation in\n/app/src/server/repositories/drafts.ts:73:45\n\n${excerpt}` +
      `→ 73 const row = await clientOf(db).documentDraft.upsert(\nError occurred during query execution:\n` +
      `ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "${sqlState}", ` +
      `message: ${debugString(message)}, severity: "ERROR", detail: ${detailText}, column: None, hint: None }), transient: false })`,
    { clientVersion },
  );
}

const BASE_POSITIVE = 'new row for relation "DocumentDraft" violates check constraint "DocumentDraft_base_positive"';
const failingRow = (title: string) => `Failing row contains (cmv1, cmv2, ${title}, {}, 0, 2026-10-09 13:43:20.092).`;

const paths = (e: unknown) => (e instanceof ValidationError ? e.errors.map((x) => x.path) : e);

describe("mapDbError matches only the primary message, never DETAIL", () => {
  const hostile = [
    "pinned by a baseline",
    "document_tree_guard: a document cannot be its own parent",
    'violates check constraint "Document_title_length"',
    'x", severity: "ERROR", detail: None }) PostgresError { code: "23514", message: "pinned by a baseline',
    "Attachment_size_matches\nDETAIL: Document_live_spaceId_title_key",
  ];

  it.each(hostile)("ORM shape, title %j → ValidationError(baseVersion)", (title) => {
    expect(paths(mapDbError(orm("23514", BASE_POSITIVE, failingRow(title))))).toEqual(["baseVersion"]);
  });

  it.each(hostile)("raw shape, title %j → ValidationError(baseVersion)", (title) => {
    expect(paths(mapDbError(raw("23514", `ERROR: ${BASE_POSITIVE}\nDETAIL: ${failingRow(title)}`)))).toEqual(["baseVersion"]);
  });

  it("names the violated CHECK exactly, whatever order the table of checks is in", () => {
    const msg = 'new row for relation "Attachment" violates check constraint "Attachment_content_type_length"';
    const detail = "Failing row contains (a, d, Attachment_size_matches.png, x, 1, aaaa, \\x01, u, 2026-10-09, null).";
    expect(paths(mapDbError(orm("23514", msg, detail)))).toEqual(["contentType"]);
    expect(paths(mapDbError(raw("23514", `ERROR: ${msg}\nDETAIL: ${detail}`)))).toEqual(["contentType"]);
  });

  it("an unknown CHECK, or a trigger message only in DETAIL, is not mapped", () => {
    const e = orm("23514", 'new row for relation "X" violates check constraint "X_other"', failingRow("pinned by a baseline"));
    expect(mapDbError(e)).toBe(e);
  });

  it("call-site source lines printed before the engine error do not count either", () => {
    const excerpt = '  70 // QueryError(PostgresError { code: "23514", message: "pinned by a baseline", severity: "ERROR" })\n';
    expect(paths(mapDbError(orm("23514", BASE_POSITIVE, null, excerpt)))).toEqual(["baseVersion"]);
  });

  it("inspectDbError exposes the primary message and constraint, not the row", () => {
    const f = inspectDbError(orm("23514", BASE_POSITIVE, failingRow("secret title")));
    expect(f).toMatchObject({ sqlState: "23514", message: BASE_POSITIVE, constraint: "DocumentDraft_base_positive" });
    expect(JSON.stringify(f)).not.toContain("secret title");
    const r = inspectDbError(raw("23514", `ERROR: ${BASE_POSITIVE}\nDETAIL: ${failingRow("secret title")}`));
    expect(r).toMatchObject({ sqlState: "23514", message: BASE_POSITIVE, constraint: "DocumentDraft_base_positive" });
    expect(JSON.stringify(r)).not.toContain("secret title");
  });
});

describe("trigger messages map by their exact text", () => {
  it("every document_tree_guard refusal, in both shapes", () => {
    const cases: readonly [string, unknown][] = [
      ["document_tree_guard: a document cannot be its own parent", CycleError],
      ["document_tree_guard: a document cannot be moved under its own descendant", CycleError],
      ["document_tree_guard: the parent must be in the same space", ["parentId"]],
      ["document_tree_guard: the document tree is implausibly deep", ["parentId"]],
      ["document_tree_guard: a document with children cannot change space", ["spaceId"]],
    ];
    for (const [message, expected] of cases) {
      for (const e of [orm("23514", message, null), raw("23514", `ERROR: ${message}`)]) {
        const m = mapDbError(e);
        if (Array.isArray(expected)) expect(paths(m), message).toEqual(expected);
        else expect(m, message).toBeInstanceOf(expected as typeof CycleError);
      }
    }
  });

  it("a pinned version's delete, in both shapes", () => {
    const message = "DocumentVersion cmv10mc3s00497du4707lzr5d is pinned by a baseline and cannot be deleted";
    expect(mapDbError(orm("23514", message, null))).toBeInstanceOf(PinnedVersionError);
    expect(mapDbError(raw("23514", `ERROR: ${message}`))).toBeInstanceOf(PinnedVersionError);
  });
});

describe("unique violations look at the key's columns, never its values", () => {
  it("raw: the live-title index → TitleTakenError; another key whose value mentions it → unmapped", () => {
    const title = raw("23505", 'Key ("spaceId", lower(title COLLATE "und-x-icu"))=(sp1, specs) already exists.');
    expect(mapDbError(title)).toBeInstanceOf(TitleTakenError);
    const other = raw("23505", "Key (name)=(lower(title) Document_live_spaceId_title_key) already exists.");
    expect(mapDbError(other)).toBe(other);
    const values = raw("23505", 'Key ("spaceId", name)=(sp1, x)=(lower(title)) already exists.');
    expect(mapDbError(values)).toBe(values);
    expect(inspectDbError(values)).toMatchObject({ message: null, constraint: null, keyColumns: '"spaceId", name' });
  });

  it("ORM P2002: meta.target decides", () => {
    const title = new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`spaceId`,`lower(title COLLATE und-x-icu)`)", {
      code: "P2002",
      clientVersion,
      meta: { modelName: "Document", target: ["spaceId", "lower(title COLLATE und-x-icu)"] },
    });
    expect(mapDbError(title)).toBeInstanceOf(TitleTakenError);
    const other = new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`name`) lower(title", {
      code: "P2002",
      clientVersion,
      meta: { modelName: "Group", target: ["name"] },
    });
    expect(mapDbError(other)).toBe(other);
  });
});
