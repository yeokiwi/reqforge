// Request shapes of the pages API (spec 08 §3.1). Routes parse with these; the use cases then
// apply the domain rules (titles, change notes, content) that need more than a type check.
// Unknown keys are ignored.
import { z } from "zod";
import { NotFoundError, ValidationError } from "@/domain/errors";

const INT4_MAX = 2_147_483_647;

const versionNumber = z.number().int().min(1).max(INT4_MAX);
const content = z.unknown().refine((v) => v !== undefined, { message: "Required" });

// spec: docs/specs/08-api-surface.md section 3 (POST /pages: { title?, parentId? })
export const createPageBody = z.object({
  title: z.string().optional(),
  parentId: z.string().nullable().optional(),
});

// spec: docs/specs/08-api-surface.md section 3.1 (PublishRequest)
export const publishBody = z.object({
  title: z.string(),
  content,
  baseVersion: versionNumber,
  message: z.string().nullable().optional(),
  notifyWatchers: z.boolean().optional(),
  overwrite: z.boolean().optional(),
});

// spec: docs/specs/08-api-surface.md section 3.1 (DraftRequest)
export const draftBody = z.object({
  title: z.string(),
  content,
  baseVersion: versionNumber,
});

// spec: docs/specs/08-api-surface.md section 3 (PATCH /pages/{id}: { title })
export const renameBody = z.object({ title: z.string() });

// spec: docs/specs/08-api-surface.md section 3 (POST /pages/{id}/move: { parentId: string | null, index: number })
export const moveBody = z.object({
  parentId: z.string().nullable(),
  index: z.number(),
});

// spec: docs/specs/08-api-surface.md section 3 (POST /pages/{id}/copy: { title? })
export const copyBody = z.object({ title: z.string().optional() });

/** A `{n}` path segment: a version number, or NotFound (08 §3.2: malformed is not found). */
// spec: docs/specs/08-api-surface.md section 3.2 (NOT_FOUND: unknown, malformed)
export function versionSegment(raw: string): number {
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) throw new NotFoundError("Version");
  const n = Number(raw);
  if (n > INT4_MAX) throw new NotFoundError("Version");
  return n;
}

/**
 * The optional `?version=N` query parameter: absent, or a positive integer written in decimal
 * (else VALIDATION — a malformed field). A well-formed number no version has, however large, is
 * passed on and answered NOT_FOUND by the use case, like any other unknown version.
 */
// spec: docs/specs/08-api-surface.md section 3 (GET /pages/{id}?version=N), section 3.2 (VALIDATION, NOT_FOUND)
export function versionQuery(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  if (!/^[1-9][0-9]*$/.test(raw)) throw new ValidationError([{ path: "version", message: "must be a positive integer" }]);
  return Number(raw);
}

export type PageFormat = "json" | "html";

/** The optional `?format=` query parameter: `json` (default) or `html`. */
// spec: docs/specs/08-api-surface.md section 3 (?format=html)
export function formatQuery(raw: string | null): PageFormat {
  if (raw === null || raw === "json") return "json";
  if (raw === "html") return "html";
  throw new ValidationError([{ path: "format", message: "must be json or html" }]);
}
