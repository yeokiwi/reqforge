// The wire shapes of the pages API (docs/specs/08-api-surface.md section 3.1 and 3.2), in ONE
// place that both the server (route handlers, use cases) and the browser (the editor's API client)
// import. src/editor may not import src/server, so a shared copy here is what keeps the two sides
// from drifting. Types only: no runtime code, no imports.
//
// spec: docs/specs/08-api-surface.md sections 3.1, 3.2

/** A user as pages show them. Never an email address. */
export interface UserRef {
  readonly id: string;
  readonly name: string;
}

export interface PageSummary {
  readonly id: string;
  readonly title: string;
  readonly parentId: string | null;
  readonly ordinal: number;
  /** The number of the current version. */
  readonly currentVersion: number;
  /** The current version's createdAt, ISO-8601 UTC. */
  readonly lastModifiedAt: string;
}

export interface PageDetail extends PageSummary {
  readonly spaceKey: string;
  /** Root first, excluding the page itself. */
  readonly ancestors: readonly { readonly id: string; readonly title: string }[];
  readonly createdBy: UserRef;
  readonly createdAt: string;
  readonly lastModifiedBy: UserRef;
  /** How many live pages a delete would take with it. */
  readonly descendantCount: number;
  /** For the caller. */
  readonly watching: boolean;
  readonly favourite: boolean;
  /** The caller has an unpublished draft of this page. */
  readonly hasDraft: boolean;
  readonly permissions: { readonly canEdit: boolean; readonly canAdmin: boolean };
}

export interface VersionSummary {
  readonly number: number;
  readonly title: string;
  readonly message: string | null;
  readonly author: UserRef;
  readonly createdAt: string;
  readonly current: boolean;
  readonly pinned: boolean;
  /** Baseline numbers that pin it; absent until slice 13. */
  readonly pinnedBy?: readonly number[];
}

export interface VersionDetail extends VersionSummary {
  /** Canonical ProseMirror JSON (03 section 1.5). */
  readonly content: unknown;
}

export interface GetPageResponse {
  readonly page: PageDetail;
  readonly version: VersionDetail;
}

export interface DraftRequest {
  readonly title: string;
  readonly content: unknown;
  readonly baseVersion: number;
}

export interface DraftResponse {
  readonly savedAt: string;
  readonly stale: boolean;
  readonly currentVersion: number;
}

export interface Draft {
  readonly title: string;
  readonly content: unknown;
  readonly baseVersion: number;
  readonly updatedAt: string;
  readonly stale: boolean;
  readonly currentVersion: number;
}

export interface PublishRequest {
  readonly title: string;
  readonly content: unknown;
  /** The version the editor opened from. */
  readonly baseVersion: number;
  /** `What did you change?`, at most 500 characters. */
  readonly message?: string;
  /** Recorded on the audit event, not delivered (RD-061). */
  readonly notifyWatchers?: boolean;
  /** Publish over a newer version (RD-055). */
  readonly overwrite?: boolean;
}

export interface PublishResponse {
  readonly page: PageDetail;
  readonly version: VersionSummary;
  /** Indexer diagnostics; `[]` until slice 2. */
  readonly diagnostics: readonly unknown[];
}

export interface AttachmentRef {
  readonly id: string;
  readonly filename: string;
  readonly contentType: string;
  readonly size: number;
  /** /api/v1/attachments/{id}/{filename} */
  readonly url: string;
  readonly image: boolean;
  readonly uploadedBy: UserRef;
  readonly createdAt: string;
}

/** The stable `code` of a problem+json response (08 section 3.2). Clients branch on this. */
export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "ORIGIN_MISMATCH"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "TITLE_TAKEN"
  | "VERSION_CONFLICT"
  | "CYCLE"
  | "CURRENT_VERSION"
  | "PINNED_VERSION"
  | "TOO_LARGE"
  | "UNSUPPORTED_MEDIA"
  | "RENDER_UNSUPPORTED"
  | "INTERNAL";

/** RFC 9457 problem details as this API sends them. */
export interface ProblemDetails {
  readonly type: "about:blank";
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code: ApiErrorCode;
  /** VALIDATION */
  readonly errors?: readonly { readonly path: string; readonly message: string }[];
  /** VERSION_CONFLICT */
  readonly currentVersion?: number;
  /** TOO_LARGE */
  readonly limit?: number;
}
