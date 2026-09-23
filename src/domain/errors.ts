/**
 * Typed errors crossing every boundary. CLAUDE.md: "Errors thrown across a boundary are
 * typed (`AppError` subclasses), never bare strings."
 *
 * `code` is stable and machine-readable; `status` is the HTTP mapping used by the REST
 * surface (spec: 08-api-surface.md §1 — RFC 9457 problem details).
 */
export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;

  constructor(
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = new.target.name;
  }

  /**
   * RFC 9457 problem details (spec 08 §1). `title` is constant for the problem type and
   * `detail` is this occurrence's explanation, as the RFC requires: `detail` is a string,
   * never an object. Structured context rides along as extension members, e.g. an RQL
   * failure's `errors` (spec 02 §9).
   */
  toProblem(): Problem {
    return {
      type: `https://reqforge.dev/problems/${this.code.toLowerCase().replace(/_/g, '-')}`,
      title: PROBLEM_TITLES[this.code] ?? 'Request failed',
      status: this.status,
      detail: this.message,
      code: this.code,
      ...(this.details ? { ...this.details } : {}),
    };
  }
}

export type Problem = {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  [extension: string]: unknown;
};

const PROBLEM_TITLES: Readonly<Record<string, string>> = {
  NOT_AUTHENTICATED: 'Not authenticated',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND: 'Not found',
  VALIDATION_FAILED: 'Validation failed',
  CONFLICT: 'Conflict',
  LIMIT_EXCEEDED: 'Limit exceeded',
  QUERY_INVALID: 'Invalid query',
};

export class AuthenticationError extends AppError {
  readonly code = 'NOT_AUTHENTICATED';
  readonly status = 401;
}

export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN';
  readonly status = 403;
}

export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND';
  readonly status = 404;
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_FAILED';
  readonly status = 422;
}

export class ConflictError extends AppError {
  readonly code = 'CONFLICT';
  readonly status = 409;
}

/** spec: 07-permissions-and-limits.md §4 — "an error with the limit named in the message". */
export class LimitExceededError extends AppError {
  readonly code = 'LIMIT_EXCEEDED';
  readonly status = 422;

  constructor(limitName: string, limit: number, actual: number) {
    super(`Limit "${limitName}" exceeded: ${actual} exceeds the maximum of ${limit}.`, {
      limitName,
      limit,
      actual,
    });
  }
}

/** spec: 02-query-language.md §9 — query failures carry an offset so the editor can underline. */
export class QueryError extends AppError {
  readonly code = 'QUERY_INVALID';
  readonly status = 400;
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
