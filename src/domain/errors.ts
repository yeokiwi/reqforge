// Errors thrown across a boundary are typed (CLAUDE.md "Code conventions"), never bare
// strings. `code` is stable and machine-readable; `message` is for logs, not for users —
// user-facing text comes from the copy deck.

export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The caller is not signed in (or their session has expired). */
export class UnauthenticatedError extends AppError {
  constructor() {
    super("UNAUTHENTICATED", "Authentication is required");
  }
}

/**
 * The thing does not exist *as far as this caller can tell*. Used instead of a 403 whenever
 * revealing existence would leak information (spec 07 §2.2, rule X2: omitted, not redacted).
 */
export class NotFoundError extends AppError {
  constructor(what: string) {
    super("NOT_FOUND", `${what} not found`);
  }
}

/** The caller can see the thing but lacks the permission for this action. */
export class ForbiddenError extends AppError {
  constructor(action: string) {
    super("FORBIDDEN", `Not permitted: ${action}`);
  }
}

/** Sign-in refused. One class for "unknown email" and "wrong password" on purpose. */
export class InvalidCredentialsError extends AppError {
  constructor() {
    super("INVALID_CREDENTIALS", "Incorrect email or password");
  }
}

/** Too many failed sign-ins for this key; retry after `retryAfterSeconds`. */
export class ThrottledError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super("THROTTLED", `Too many attempts; retry in ${retryAfterSeconds}s`);
  }
}

// ---- Pages (slice 1). Codes and extras are the table in spec 08 §3.2. ----------------------

/** One malformed field. `path` names the request field (`title`, `content.0.attrs.src`, …). */
export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

/** A field is malformed, or content failed the schema. 422. */
// spec: docs/specs/08-api-surface.md section 3.2 (VALIDATION, extras: errors)
export class ValidationError extends AppError {
  constructor(readonly errors: readonly ValidationIssue[]) {
    super("VALIDATION", `Invalid: ${errors.map((e) => `${e.path}: ${e.message}`).join("; ") || "request"}`);
  }
}

/** Another live page in the space already has this title, compared case-insensitively. 409. */
// spec: docs/specs/08-api-surface.md section 3.2 (TITLE_TAKEN); docs/specs/09-decision-log.md section RD-056
export class TitleTakenError extends AppError {
  constructor() {
    super("TITLE_TAKEN", "Another live page in this space has that title");
  }
}

/** Publish from a version that is no longer current, without `overwrite`. 409. */
// spec: docs/specs/08-api-surface.md section 3.2 (VERSION_CONFLICT, extras: currentVersion); RD-055
export class VersionConflictError extends AppError {
  constructor(readonly currentVersion: number) {
    super("VERSION_CONFLICT", `The page has a newer version (${currentVersion})`);
  }
}

/** A move would put a page under itself or one of its descendants. 409. */
// spec: docs/specs/08-api-surface.md section 3.2 (CYCLE); RD-056
export class CycleError extends AppError {
  constructor() {
    super("CYCLE", "A page cannot be moved under itself or one of its descendants");
  }
}

/** Delete of the page's current version. 409. */
// spec: docs/specs/08-api-surface.md section 3.2 (CURRENT_VERSION); RD-060
export class CurrentVersionError extends AppError {
  constructor() {
    super("CURRENT_VERSION", "The current version cannot be deleted");
  }
}

/** Delete of a version pinned by a baseline (invariant D2). 409. */
// spec: docs/specs/08-api-surface.md section 3.2 (PINNED_VERSION); docs/specs/01-domain-model.md (invariant D2); RD-060
export class PinnedVersionError extends AppError {
  constructor() {
    super("PINNED_VERSION", "The version is pinned by a baseline and cannot be deleted");
  }
}

/** Content or an attachment over its size limit; `limit` is in bytes. 413. */
// spec: docs/specs/08-api-surface.md section 3.2 (TOO_LARGE, extras: limit); RD-058, RD-063
export class TooLargeError extends AppError {
  constructor(readonly limit: number) {
    super("TOO_LARGE", `Larger than the limit of ${limit} bytes`);
  }
}

/** A refused attachment type (SVG) or a body that is not JSON. 415. */
// spec: docs/specs/08-api-surface.md section 3.2 (UNSUPPORTED_MEDIA); RD-058
export class UnsupportedMediaError extends AppError {
  constructor(what = "media type") {
    super("UNSUPPORTED_MEDIA", `Unsupported ${what}`);
  }
}
