// Turns the database's refusals into the typed errors of spec 08 §3.2. The database is the
// authority on the invariants of prisma/migrations/20261009120000_documents (and its follow-up
// 20261009150000_documents_hardening); this module only translates.
//
// Prisma surfaces the same refusal in three shapes:
//   P2002 / P2003          — ORM unique / foreign-key violations, with `meta`
//   P2010                  — any failure of $queryRaw / $executeRaw: `meta.code` = SQLSTATE,
//                            `meta.message` = "ERROR: <primary>\nDETAIL: <detail>"
//   UnknownRequestError    — trigger exceptions and CHECK violations raised under the ORM; only
//                            the query engine's debug print `PostgresError { code, message,
//                            severity, detail, … }` carries them, after the call-site excerpt
//
// What may be matched: the SQLSTATE, the PRIMARY message, and constraint / column names. Never
// the DETAIL ("Failing row contains (…)", "Key (…)=(…)"), which echoes the row's values — titles,
// filenames, user content — and never Prisma's call-site excerpt. Otherwise a page titled
// "pinned by a baseline" could turn a ValidationError into PinnedVersionError.
import { Prisma } from "@prisma/client";
import {
  CurrentVersionError,
  CycleError,
  NotFoundError,
  PinnedVersionError,
  TitleTakenError,
  ValidationError,
  type AppError,
} from "@/domain/errors";

/** What a database failure says, whichever Prisma shape it arrived in. Holds no row values. */
export interface DbFailure {
  /** SQLSTATE, e.g. 23505 unique, 23503 foreign key, 23514 check / trigger. Null if unknown. */
  readonly sqlState: string | null;
  /**
   * PostgreSQL's primary message without its severity prefix: `new row for relation "X" violates
   * check constraint "Y"`, or a trigger's RAISE text. Null when Prisma passed none on (ORM P2002 /
   * P2003 carry `meta` instead; raw unique violations carry only the DETAIL).
   */
  readonly message: string | null;
  /** The constraint or index the database named, from `meta` or from the primary message. */
  readonly constraint: string | null;
  /** Unique violations that name no constraint: the key's columns (never its values). */
  readonly keyColumns: string | null;
  /** For foreign keys: was the write the referencing row ("insert") or the referenced one ("delete")? */
  readonly foreignKeySide: "insert" | "delete" | null;
}

function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

/** The first line of libpq's "SEVERITY: primary\nDETAIL: …\nHINT: …", severity removed. */
function primaryLine(text: string): string {
  return (text.split("\n", 1)[0] ?? "").replace(/^(?:ERROR|FATAL|PANIC):\s+/, "");
}

/** The constraint a primary message names. The message is the server's, so the name is trusted. */
function constraintIn(message: string | null): string | null {
  if (message === null) return null;
  return (
    /^new row for relation "[^"]+" violates check constraint "([^"]+)"$/.exec(message)?.[1] ??
    /^(?:insert or update|update or delete) on table "[^"]+" violates foreign key constraint "([^"]+)"/.exec(message)?.[1] ??
    /^duplicate key value violates unique constraint "([^"]+)"$/.exec(message)?.[1] ??
    null
  );
}

function foreignKeySideOf(message: string | null): "insert" | "delete" | null {
  if (message === null) return null;
  if (/^insert or update on table /.test(message)) return "insert";
  if (/^update or delete on table /.test(message)) return "delete";
  return null;
}

/** Undoes Rust's `{:?}` escaping of a string body (`\"`, `\\`, `\n`, `\u{…}`, …). */
function unescapeDebug(body: string): string {
  return body.replace(/\\(?:u\{([0-9a-fA-F]{1,6})\}|(.))/g, (whole, hex: string | undefined, ch: string | undefined) => {
    if (hex !== undefined) {
      const cp = Number.parseInt(hex, 16);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    switch (ch) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "0":
        return "\0";
      default:
        return ch ?? whole;
    }
  });
}

// The engine's print starts after the last real line "Error occurred during query execution:".
// Inside it, the DETAIL is a debug-escaped string, so user content can contain neither a real
// newline nor an unescaped `"`: it cannot forge this header or a second `code: "…", message: "…"`.
const ENGINE_HEADER = "\nError occurred during query execution:\n";
const POSTGRES_ERROR = /PostgresError \{ code: "([0-9A-Z]{5})", message: "((?:[^"\\]|\\.)*)"/;

function fromEnginePrint(text: string): { readonly sqlState: string | null; readonly message: string | null } {
  const at = text.lastIndexOf(ENGINE_HEADER);
  const m = POSTGRES_ERROR.exec(at >= 0 ? text.slice(at) : text);
  if (!m || m[1] === undefined || m[2] === undefined) return { sqlState: null, message: null };
  return { sqlState: m[1], message: unescapeDebug(m[2]) };
}

/** `Key (cols)=(values) already exists.` → `cols`. The first `)=(` ends the columns; values follow it. */
function keyColumnsIn(detail: string): string | null {
  return /^Key \((.*?)\)=\(/.exec(detail)?.[1] ?? null;
}

/**
 * What the database refused, from whichever Prisma error carries it; null if `e` is not a
 * database failure. Reads only the SQLSTATE, the primary message and constraint names.
 */
// spec: docs/specs/08-api-surface.md section 3.2 (stable error codes: never derived from user content)
export function inspectDbError(e: unknown): DbFailure | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = (e.meta ?? {}) as Record<string, unknown>;
    switch (e.code) {
      case "P2002": {
        // `target` is the key's fields, or (older engines) the index name.
        const target = meta.target;
        const keyColumns = Array.isArray(target) ? target.map(str).join(", ") : null;
        const constraint = typeof target === "string" ? target : null;
        return { sqlState: "23505", message: null, constraint, keyColumns, foreignKeySide: null };
      }
      case "P2003": {
        // The ORM names the model it was writing; the constraint is named after the referencing
        // table. Writing the referencing table means its reference was missing.
        const model = str(meta.modelName);
        const constraint = str(meta.constraint ?? meta.field_name);
        const side = model !== "" && constraint.startsWith(`${model}_`) ? "insert" : "delete";
        return { sqlState: "23503", message: null, constraint: constraint === "" ? null : constraint, keyColumns: null, foreignKeySide: side };
      }
      case "P2010": {
        const sqlState = typeof meta.code === "string" ? meta.code : null;
        const pg = str(meta.message);
        // For unique violations the engine passes on only the DETAIL, "Key (…)=(…) already exists.".
        if (/^Key \(/.test(pg)) {
          return { sqlState, message: null, constraint: null, keyColumns: keyColumnsIn(pg), foreignKeySide: null };
        }
        const message = pg === "" ? null : primaryLine(pg);
        return {
          sqlState,
          message,
          constraint: constraintIn(message),
          keyColumns: null,
          foreignKeySide: sqlState === "23503" ? foreignKeySideOf(message) : null,
        };
      }
      default:
        return { sqlState: null, message: null, constraint: null, keyColumns: null, foreignKeySide: null };
    }
  }
  if (e instanceof Prisma.PrismaClientUnknownRequestError) {
    const { sqlState, message } = fromEnginePrint(e.message);
    return {
      sqlState,
      message,
      constraint: constraintIn(message),
      keyColumns: null,
      foreignKeySide: sqlState === "23503" ? foreignKeySideOf(message) : null,
    };
  }
  return null;
}

/** CHECK constraints, by exact name. */
const CHECKS: ReadonlyMap<string, { readonly path: string; readonly message: string }> = new Map([
  ["Document_title_length", { path: "title", message: "must be 1 to 255 characters after trimming" }],
  ["DocumentVersion_title_length", { path: "title", message: "must be 1 to 255 characters after trimming" }],
  ["DocumentDraft_title_length", { path: "title", message: "must be at most 255 characters" }],
  ["DocumentVersion_message_length", { path: "message", message: "must be at most 500 characters" }],
  ["DocumentVersion_number_positive", { path: "number", message: "must be positive" }],
  ["Document_ordinal_nonnegative", { path: "ordinal", message: "must not be negative" }],
  ["Document_deleted_consistent", { path: "deletedRootId", message: "must be set exactly when deletedAt is" }],
  ["DocumentDraft_base_positive", { path: "baseVersion", message: "must be positive" }],
  ["Attachment_size_matches", { path: "file", message: "must be 1 byte to 10 MiB, and size must match the bytes" }],
  ["Attachment_sha256_hex", { path: "sha256", message: "must be the lower-case hex SHA-256 of the bytes" }],
  ["Attachment_sha256_matches", { path: "sha256", message: "must be the lower-case hex SHA-256 of the bytes" }],
  ["Attachment_filename_length", { path: "filename", message: "must be 1 to 255 characters" }],
  ["Attachment_content_type_length", { path: "contentType", message: "must be 3 to 255 characters" }],
]);

/** Trigger refusals (all ERRCODE 23514), by their exact RAISE text in the migrations. */
const TREE_GUARD: ReadonlyMap<string, () => AppError> = new Map<string, () => AppError>([
  ["document_tree_guard: a document cannot be its own parent", () => new CycleError()],
  ["document_tree_guard: a document cannot be moved under its own descendant", () => new CycleError()],
  ["document_tree_guard: the parent must be in the same space", () => new ValidationError([{ path: "parentId", message: "must be a page in the same space" }])],
  ["document_tree_guard: the document tree is implausibly deep", () => new ValidationError([{ path: "parentId", message: "the page tree would be too deep" }])],
  [
    "document_tree_guard: a document with children cannot change space",
    () => new ValidationError([{ path: "spaceId", message: "a page with children cannot change space" }]),
  ],
]);
// 'DocumentVersion <id> is pinned by a baseline and cannot be deleted'; ids are generated, not user text.
const PINNED = /^DocumentVersion \S+ is pinned by a baseline and cannot be deleted$/;

// RD-056: the partial unique index on ("spaceId", lower("title" COLLATE "und-x-icu")).
const TITLE_INDEX = "Document_live_spaceId_title_key";
const TITLE_KEY_COLUMNS = /^"?spaceId"?, lower\(\(?"?title"?\b/;

/**
 * The typed error for a database refusal, or `e` itself when it is not one we know (a bug,
 * not a user error — let it surface as a 500). Usage: `catch (e) { throw mapDbError(e); }`.
 */
// spec: docs/specs/08-api-surface.md section 3.2 (error codes); docs/specs/01-domain-model.md (invariants D1, D2); RD-056, RD-058, RD-060
export function mapDbError(e: unknown): unknown {
  const f = inspectDbError(e);
  if (!f) return e;
  const typed = typedErrorFor(f);
  return typed ?? e;
}

function typedErrorFor(f: DbFailure): AppError | null {
  switch (f.sqlState) {
    case "23505": {
      const isTitle = f.constraint !== null ? f.constraint === TITLE_INDEX : f.keyColumns !== null && TITLE_KEY_COLUMNS.test(f.keyColumns);
      return isTitle ? new TitleTakenError() : null;
    }
    case "23503": {
      const c = f.constraint;
      if (c === null) return null;
      // Deleting the version a page points at as current: ON DELETE RESTRICT (RD-060).
      if (c === "Document_currentVersionId_fkey" && f.foreignKeySide === "delete") return new CurrentVersionError();
      if (f.foreignKeySide === "insert") {
        if (/_documentId_fkey|^Document_parentId_fkey/.test(c)) return new NotFoundError("Page");
        if (/_spaceId_fkey/.test(c)) return new NotFoundError("Space");
        if (/_(userId|authorId|createdById|uploadedById)_fkey/.test(c)) return new NotFoundError("User");
      }
      return null;
    }
    case "23514": {
      const message = f.message ?? "";
      const guard = TREE_GUARD.get(message);
      if (guard) return guard();
      if (PINNED.test(message)) return new PinnedVersionError();
      const check = f.constraint === null ? undefined : CHECKS.get(f.constraint);
      return check ? new ValidationError([{ path: check.path, message: check.message }]) : null;
    }
    default:
      return null;
  }
}
