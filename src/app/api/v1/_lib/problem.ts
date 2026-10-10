// RFC 9457 problem details for the pages API (spec 08 §3.2, RD-064). One table maps every
// stable `code` to its status, title and a fixed detail. Details never come from an error's
// message: messages are for logs, and a database or library message could carry SQL, row
// values or a stack. Anything that is not a known AppError is a 500 INTERNAL, logged here.
//
// Edge-safe on purpose: src/middleware.ts imports this module, and middleware runs on the
// Edge runtime. Import nothing here that needs Node (no node:*, no Prisma, no server code).
import type { ApiErrorCode, ProblemDetails } from "@/domain/documents/api-types";
import { AppError, TooLargeError, ValidationError, VersionConflictError } from "@/domain/errors";

interface ProblemSpec {
  readonly status: number;
  readonly title: string;
  readonly detail: string;
}

/** API text, not interface copy: clients branch on `code`, people read `title` and `detail`. */
// spec: docs/specs/08-api-surface.md section 3.2 (the error table)
const PROBLEMS: Readonly<Record<ApiErrorCode, ProblemSpec>> = {
  UNAUTHENTICATED: { status: 401, title: "Unauthenticated", detail: "Sign in to use this API." },
  ORIGIN_MISMATCH: {
    status: 403,
    title: "Origin mismatch",
    detail: "A state-changing request must carry an Origin header naming this site.",
  },
  FORBIDDEN: { status: 403, title: "Forbidden", detail: "You do not have the permission this action needs in this space." },
  NOT_FOUND: { status: 404, title: "Not Found", detail: "It does not exist, or you cannot see it." },
  VALIDATION: { status: 422, title: "Validation failed", detail: "Some fields are invalid; see errors." },
  TITLE_TAKEN: { status: 409, title: "Title taken", detail: "Another page in this space already has that title." },
  VERSION_CONFLICT: {
    status: 409,
    title: "Version conflict",
    detail: "The page has been published since this edit started. Overwrite it, or reload the latest version.",
  },
  CYCLE: { status: 409, title: "Cycle", detail: "A page cannot be moved under itself or one of its descendants." },
  CURRENT_VERSION: { status: 409, title: "Current version", detail: "The current version cannot be deleted." },
  PINNED_VERSION: { status: 409, title: "Pinned version", detail: "The version is pinned by a baseline and cannot be deleted." },
  TOO_LARGE: { status: 413, title: "Too large", detail: "The request is larger than the limit." },
  UNSUPPORTED_MEDIA: {
    status: 415,
    title: "Unsupported media type",
    detail: "The body must be JSON (or multipart/form-data for uploads), and SVG files are refused.",
  },
  RENDER_UNSUPPORTED: {
    status: 500,
    title: "Render unsupported",
    detail: "The page contains an element the HTML renderer cannot reproduce exactly.",
  },
  INTERNAL: { status: 500, title: "Internal Server Error", detail: "Something went wrong on the server." },
};

function isApiErrorCode(code: string): code is ApiErrorCode {
  return Object.prototype.hasOwnProperty.call(PROBLEMS, code);
}

/** The problem body for a bare code, with no extras. */
// spec: docs/specs/08-api-surface.md section 3.2
export function problemFor(code: ApiErrorCode): ProblemDetails {
  const spec = PROBLEMS[code];
  return { type: "about:blank", title: spec.title, status: spec.status, detail: spec.detail, code };
}

/**
 * The problem body for any thrown value: a known AppError keeps its code and extras (errors for
 * VALIDATION, currentVersion for VERSION_CONFLICT, limit for TOO_LARGE); everything else is
 * INTERNAL with the generic detail.
 */
// spec: docs/specs/08-api-surface.md section 3.2 (codes, statuses and extras)
export function problemFromError(error: unknown): ProblemDetails {
  if (!(error instanceof AppError) || !isApiErrorCode(error.code) || error.code === "INTERNAL") return problemFor("INTERNAL");
  const base = problemFor(error.code);
  if (error instanceof ValidationError) {
    return { ...base, errors: error.errors.map((e) => ({ path: e.path, message: e.message })) };
  }
  if (error instanceof VersionConflictError) {
    return { ...base, detail: `${base.detail} The current version is ${error.currentVersion}.`, currentVersion: error.currentVersion };
  }
  if (error instanceof TooLargeError) {
    return { ...base, detail: `The request is larger than the limit of ${error.limit} bytes.`, limit: error.limit };
  }
  return base;
}

/** An application/problem+json response for a problem body. Never cached. */
export function problemJson(problem: ProblemDetails, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set("Content-Type", "application/problem+json");
  h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(problem), { status: problem.status, headers: h });
}

/**
 * The response for a thrown value. Server faults (5xx) are logged with the original error —
 * server-side only; the body says nothing about it.
 */
// spec: docs/specs/08-api-surface.md section 3.2; docs/specs/09-decision-log.md section RD-064
export function problemResponse(error: unknown): Response {
  const problem = problemFromError(error);
  if (problem.status >= 500) console.error(`[api] ${problem.code}`, error);
  return problemJson(problem);
}
