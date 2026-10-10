// The editor's client for the pages API (08 section 3). Every endpoint URL the editor uses is
// built here and nowhere else. Requests send and accept JSON; failures become a typed ApiError
// carrying the problem+json `code`, the HTTP status and the extras (08 section 3.2), so callers
// branch on `code`, never on message text. The browser adds the `Origin` header that state-
// changing requests need (RD-064); the session cookie travels as a same-origin credential.
// spec: docs/specs/08-api-surface.md sections 3, 3.1 and 3.2 (RD-055, RD-062, RD-064)
import type {
  ApiErrorCode,
  AttachmentRef,
  Draft,
  DraftRequest,
  DraftResponse,
  GetPageResponse,
  ProblemDetails,
  PublishRequest,
  PublishResponse,
  UserRef,
} from "@/domain/documents/api-types";
import { AppError } from "@/domain/errors";

/** A problem `code` from the server, or one of the client's own failure kinds. */
export type ClientErrorCode =
  | ApiErrorCode
  /** fetch rejected: offline, DNS, connection reset, CORS. */
  | "NETWORK"
  /** The request was aborted by the caller. */
  | "ABORTED"
  /** An error without a recognisable problem body, or a success body of the wrong shape. */
  | "UNEXPECTED_RESPONSE";

// Every ApiErrorCode, checked exhaustively at compile time so a new server code is not missed.
const API_ERROR_CODES = {
  UNAUTHENTICATED: true,
  ORIGIN_MISMATCH: true,
  FORBIDDEN: true,
  NOT_FOUND: true,
  VALIDATION: true,
  TITLE_TAKEN: true,
  VERSION_CONFLICT: true,
  CYCLE: true,
  CURRENT_VERSION: true,
  PINNED_VERSION: true,
  TOO_LARGE: true,
  UNSUPPORTED_MEDIA: true,
  RENDER_UNSUPPORTED: true,
  INTERNAL: true,
} as const satisfies Record<ApiErrorCode, true>;

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(API_ERROR_CODES, value);
}

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

/** A failed API call. `status` is 0 when no response arrived. */
// spec: docs/specs/08-api-surface.md section 3.2 (problem+json: type, title, status, detail, code, extras)
export class ApiError extends AppError {
  declare readonly code: ClientErrorCode;

  constructor(
    code: ClientErrorCode,
    readonly status: number,
    /** VALIDATION extras. */
    readonly errors: readonly ValidationIssue[] = [],
    /** VERSION_CONFLICT extras. */
    readonly currentVersion: number | null = null,
    /** TOO_LARGE extras, in bytes. */
    readonly limit: number | null = null,
    /** The problem's `detail`, for logs only: user-facing text comes from the copy deck. */
    detail = "",
  ) {
    super(code, detail || `${code} (${status})`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issuesOf(value: unknown): ValidationIssue[] {
  if (!Array.isArray(value)) return [];
  const issues: ValidationIssue[] = [];
  for (const item of value) {
    if (isRecord(item) && typeof item.path === "string" && typeof item.message === "string") {
      issues.push({ path: item.path, message: item.message });
    }
  }
  return issues;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Turns an error response into an ApiError. A problem body with a known `code` keeps it and its
 * extras; anything else (an HTML error page from a proxy, an unknown code) is
 * UNEXPECTED_RESPONSE with the status, so retry decisions can still look at the status.
 */
// spec: docs/specs/08-api-surface.md section 3.2
export function problemToError(status: number, body: unknown): ApiError {
  if (!isRecord(body) || !isApiErrorCode(body.code)) {
    return new ApiError("UNEXPECTED_RESPONSE", status);
  }
  const problem = body as Partial<ProblemDetails>;
  return new ApiError(
    body.code,
    status,
    issuesOf(body.errors),
    finiteOrNull(problem.currentVersion),
    finiteOrNull(problem.limit),
    typeof problem.detail === "string" ? problem.detail : "",
  );
}

/** Whether an autosave that failed this way is worth retrying by itself. */
// spec: docs/specs/09-decision-log.md section RD-055 (autosave); 08 section 3.2
export function isRetryable(error: ApiError): boolean {
  switch (error.code) {
    case "NETWORK":
    case "INTERNAL":
    // Signing in again in another tab makes the next attempt succeed.
    case "UNAUTHENTICATED":
      return true;
    case "UNEXPECTED_RESPONSE":
      return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
    default:
      return false;
  }
}

/** Any thrown value as an ApiError (anything that is not one is a client-side surprise). */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError("UNEXPECTED_RESPONSE", 0, [], null, null, error instanceof Error ? error.message : "");
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PageRef {
  readonly spaceKey: string;
  readonly pageId: string;
}

/**
 * Bodies a browser lets `keepalive` carry (the Fetch spec caps all in-flight keepalive bodies at
 * 64 KiB). A larger save on the way out is sent normally and may be cut off by the unload; the
 * editor warns before unloading while changes are unsaved.
 */
export const KEEPALIVE_MAX_BYTES = 60_000;

const enc = encodeURIComponent;

/** Every URL the editor calls. */
// spec: docs/specs/08-api-surface.md section 3 (paths under /api/v1/spaces/{spaceKey})
export const pageUrls = {
  page: (p: PageRef) => `/api/v1/spaces/${enc(p.spaceKey)}/pages/${enc(p.pageId)}`,
  draft: (p: PageRef) => `${pageUrls.page(p)}/draft`,
  presence: (p: PageRef) => `${pageUrls.page(p)}/presence`,
  attachments: (p: PageRef) => `${pageUrls.page(p)}/attachments`,
  people: (spaceKey: string, q: string) => `/api/v1/spaces/${enc(spaceKey)}/people?q=${enc(q)}`,
} as const;

interface RequestOptions<T> {
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  readonly json?: unknown;
  readonly form?: FormData;
  readonly keepalive?: boolean;
  readonly signal?: AbortSignal;
  /** Narrows the success body; null for an expected empty (204) response. */
  readonly parse: ((body: unknown) => T) | null;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  return JSON.parse(text) as unknown;
}

async function request<T>(fetchImpl: FetchLike, url: string, options: RequestOptions<T>): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json, application/problem+json" };
  let body: BodyInit | undefined;
  let keepalive = false;
  if (options.json !== undefined) {
    const text = JSON.stringify(options.json);
    headers["Content-Type"] = "application/json";
    body = text;
    keepalive = options.keepalive === true && utf8Length(text) <= KEEPALIVE_MAX_BYTES;
  } else if (options.form) {
    body = options.form; // the browser sets the multipart boundary
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: options.method,
      headers,
      body,
      credentials: "same-origin",
      cache: "no-store",
      keepalive,
      signal: options.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new ApiError(aborted ? "ABORTED" : "NETWORK", 0, [], null, null, error instanceof Error ? error.message : "");
  }

  if (!response.ok) {
    let problem: unknown;
    try {
      problem = await readJson(response);
    } catch {
      problem = undefined;
    }
    throw problemToError(response.status, problem);
  }

  if (options.parse === null) return undefined as T;
  let parsed: unknown;
  try {
    parsed = await readJson(response);
  } catch {
    throw new ApiError("UNEXPECTED_RESPONSE", response.status);
  }
  return options.parse(parsed);
}

// ------------------------------------------------------------------------ response narrowing

function bad(what: string): never {
  throw new ApiError("UNEXPECTED_RESPONSE", 200, [], null, null, `malformed ${what}`);
}

function asUserRef(value: unknown): UserRef | null {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string"
    ? { id: value.id, name: value.name }
    : null;
}

function userRefs(value: unknown, what: string): UserRef[] {
  if (!Array.isArray(value)) bad(what);
  return value.map(asUserRef).filter((u): u is UserRef => u !== null);
}

export function parseDraftResponse(body: unknown): DraftResponse {
  if (
    !isRecord(body) ||
    typeof body.savedAt !== "string" ||
    typeof body.stale !== "boolean" ||
    typeof body.currentVersion !== "number"
  ) {
    return bad("DraftResponse");
  }
  return { savedAt: body.savedAt, stale: body.stale, currentVersion: body.currentVersion };
}

export function parseDraftEnvelope(body: unknown): Draft | null {
  if (!isRecord(body) || !("draft" in body)) return bad("{ draft }");
  const draft = body.draft;
  if (draft === null) return null;
  if (
    !isRecord(draft) ||
    typeof draft.title !== "string" ||
    typeof draft.baseVersion !== "number" ||
    typeof draft.stale !== "boolean" ||
    typeof draft.currentVersion !== "number"
  ) {
    return bad("Draft");
  }
  return draft as unknown as Draft;
}

export function parsePublishResponse(body: unknown): PublishResponse {
  if (!isRecord(body) || !isRecord(body.page) || !isRecord(body.version) || typeof body.version.number !== "number") {
    return bad("PublishResponse");
  }
  return { ...(body as unknown as PublishResponse), diagnostics: Array.isArray(body.diagnostics) ? body.diagnostics : [] };
}

export function parseGetPageResponse(body: unknown): GetPageResponse {
  if (
    !isRecord(body) ||
    !isRecord(body.page) ||
    !isRecord(body.version) ||
    typeof body.version.number !== "number" ||
    typeof body.version.title !== "string" ||
    !("content" in body.version)
  ) {
    return bad("GetPageResponse");
  }
  return body as unknown as GetPageResponse;
}

export function parsePresence(body: unknown): UserRef[] {
  if (!isRecord(body)) return bad("{ others }");
  return userRefs(body.others, "{ others }");
}

export function parsePeople(body: unknown): UserRef[] {
  if (!isRecord(body)) return bad("{ people }");
  return userRefs(body.people, "{ people }");
}

export function parseAttachmentRef(body: unknown): AttachmentRef {
  if (
    !isRecord(body) ||
    typeof body.id !== "string" ||
    typeof body.filename !== "string" ||
    typeof body.url !== "string" ||
    typeof body.image !== "boolean"
  ) {
    return bad("AttachmentRef");
  }
  return body as unknown as AttachmentRef;
}

// ------------------------------------------------------------------------------- the client

export interface PageApi {
  /** PUT /pages/{id}/draft: autosave; never creates history. */
  saveDraft(body: DraftRequest, options?: { keepalive?: boolean; signal?: AbortSignal }): Promise<DraftResponse>;
  /** GET /pages/{id}/draft: the caller's own unpublished draft, or null. */
  getDraft(signal?: AbortSignal): Promise<Draft | null>;
  /** DELETE /pages/{id}/draft: revert to last published; idempotent. */
  discardDraft(): Promise<void>;
  /** PUT /pages/{id}: publish a new version. */
  publish(body: PublishRequest): Promise<PublishResponse>;
  /** GET /pages/{id}: the page and its current version's content. */
  getPage(signal?: AbortSignal): Promise<GetPageResponse>;
  /** POST /pages/{id}/presence: heartbeat; the other users with the page open. */
  heartbeat(signal?: AbortSignal): Promise<UserRef[]>;
  /** POST /pages/{id}/attachments: upload one file (multipart field `file`). */
  uploadAttachment(file: Blob, filename: string, signal?: AbortSignal): Promise<AttachmentRef>;
  /** GET /people?q=: up to 10 users who can view the space, for `@mention`. */
  searchPeople(q: string, signal?: AbortSignal): Promise<UserRef[]>;
}

/** The pages API for one page. `fetchImpl` is injectable for tests. */
// spec: docs/specs/08-api-surface.md section 3 (draft, publish, presence, attachments, people)
export function createPageApi(page: PageRef, fetchImpl: FetchLike = (input, init) => fetch(input, init)): PageApi {
  return {
    saveDraft: (body, options) =>
      request(fetchImpl, pageUrls.draft(page), {
        method: "PUT",
        json: body,
        keepalive: options?.keepalive,
        signal: options?.signal,
        parse: parseDraftResponse,
      }),
    getDraft: (signal) => request(fetchImpl, pageUrls.draft(page), { method: "GET", signal, parse: parseDraftEnvelope }),
    discardDraft: () => request<void>(fetchImpl, pageUrls.draft(page), { method: "DELETE", parse: null }),
    publish: (body) => request(fetchImpl, pageUrls.page(page), { method: "PUT", json: body, parse: parsePublishResponse }),
    getPage: (signal) => request(fetchImpl, pageUrls.page(page), { method: "GET", signal, parse: parseGetPageResponse }),
    heartbeat: (signal) => request(fetchImpl, pageUrls.presence(page), { method: "POST", json: {}, signal, parse: parsePresence }),
    uploadAttachment: (file, filename, signal) => {
      const form = new FormData();
      form.append("file", file, filename);
      return request(fetchImpl, pageUrls.attachments(page), { method: "POST", form, signal, parse: parseAttachmentRef });
    },
    searchPeople: (q, signal) =>
      request(fetchImpl, pageUrls.people(page.spaceKey, q), { method: "GET", signal, parse: parsePeople }),
  };
}
