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
