# 08 — REST API

Requirement Yogi's API is explicitly experimental, and most of its write endpoints are
documented as "Do not use" (research §6.5). Ours is a first-class product surface: the
integrations we care about (CI pipelines, test tools, GitHub) are API-only.

## 1. Conventions

- Vocabulary follows the UI (`RD-032`): resources are **pages**, not documents.
- Base path `/api/v1`. Versioned; `v1` is stable once slice 17 ships.
- Auth: session cookie for the app; **API tokens** (scoped, per user, revocable) for
  machines. Bearer header.
- Every endpoint enforces the same permission and visibility rules as the UI
  (`07-permissions-and-limits.md`, rule X3). There is no privileged API path.
- Errors: RFC 9457 problem details, with the RQL error shape from `02` §9 embedded for
  query failures.
- Pagination: `?limit` (default 50, max 600) and an opaque `?cursor`. Never offset.
- All list responses carry `total` only when it is cheap; otherwise `hasMore`.
- OpenAPI 3.1 document served at `/api/v1/openapi.json` and generated **from the route
  handlers**, not hand-written.
- One endpoint lives outside `/api/v1`: `GET /api/health`, an unauthenticated readiness
  probe for Docker, CI and load balancers. It answers `200 {"status":"ok","database":true}`
  or `503 {"status":"degraded","database":false}` and reveals nothing else (slice 0).

## 2. Requirements

| Method | Path | Notes |
|---|---|---|
| `GET` | `/spaces/{spaceKey}/requirements?q=&baseline=&limit=&cursor=&expand=` | `q` is RQL. `expand ∈ {properties, dependencies, links, validation}` |
| `GET` | `/spaces/{spaceKey}/requirements/{key}` | `?baseline=<number\|current>` |
| `GET` | `/spaces/{spaceKey}/requirements/{key}/history` | |
| `PATCH` | `/spaces/{spaceKey}/requirements/{key}/external-properties` | the only write path to a requirement |

There is deliberately **no** create/update/delete for requirements. A requirement's text
and inline properties come from its document (overview, decision 2); writing them means
editing the document. This is the same conclusion RY reached, arrived at on purpose.

## 3. Pages

All paths are under `/api/v1/spaces/{spaceKey}`, except attachment bytes. `{spaceKey}` is
case-insensitive. Session cookie only until slice 17 (`RD-064`); every `POST`/`PUT`/`PATCH`/
`DELETE` must carry an `Origin` matching the host.

| Method | Path | Needs | Notes |
|---|---|---|---|
| `GET` | `/pages` | `VIEW` | the whole tree as a flat `PageSummary[]`, ordered by `ordinal` within `parentId` |
| `POST` | `/pages` | `EDIT` | create (`RD-056`); body `{ title?, parentId? }`; `201` |
| `GET` | `/pages/{id}` | `VIEW` | `PageDetail` + the version's content; `?version=N` for a past version; `?format=html` returns the rendered fragment (`text/html`) |
| `PUT` | `/pages/{id}` | `EDIT` | **publish** a new version (`PublishRequest`); runs the indexer once it exists (slice 2) and returns `diagnostics` |
| `PATCH` | `/pages/{id}` | `EDIT` | rename `{ title }` — creates a version (`RD-056`) |
| `POST` | `/pages/{id}/move` | `EDIT` | `{ parentId: string \| null, index: number }` within the space |
| `POST` | `/pages/{id}/copy` | `EDIT` | `{ title? }`; copies the page only; `201` |
| `DELETE` | `/pages/{id}` | `EDIT` | soft-deletes the subtree; `{ deletedCount }` |
| `GET` | `/pages/{id}/draft` | `EDIT` | `{ draft: Draft | null }` — the caller's own unpublished draft |
| `PUT` | `/pages/{id}/draft` | `EDIT` | autosave (`DraftRequest`); never creates history |
| `DELETE` | `/pages/{id}/draft` | `EDIT` | revert to last published; idempotent `204` |
| `GET` | `/pages/{id}/versions` | `VIEW` | `VersionSummary[]`, newest first |
| `GET` | `/pages/{id}/versions/{n}` | `VIEW` | `VersionDetail` |
| `POST` | `/pages/{id}/versions/{n}/restore` | `EDIT` | creates a new version from an old one (`RD-060`) |
| `DELETE` | `/pages/{id}/versions/{n}` | `ADMIN` | refused for the current (`CURRENT_VERSION`) and pinned (`PINNED_VERSION`) |
| `PUT` / `DELETE` | `/pages/{id}/watch` | `VIEW` | idempotent `204` |
| `PUT` / `DELETE` | `/pages/{id}/favourite` | `VIEW` | idempotent `204` |
| `POST` | `/pages/{id}/presence` | `VIEW` | heartbeat; returns `{ others: UserRef[] }` (`RD-062`) |
| `GET` | `/pages/{id}/attachments` | `VIEW` | live attachments, newest first |
| `POST` | `/pages/{id}/attachments` | `EDIT` | `multipart/form-data`, field `file`; `201` `AttachmentRef` |
| `DELETE` | `/pages/{id}/attachments/{attachmentId}` | `EDIT` | hides it; bytes stay (`RD-058`) |
| `GET` | `/api/v1/attachments/{attachmentId}/{filename}` | `VIEW` on the page's space | the bytes; images inline, everything else as a download |
| `POST` | `/pages/{id}/reindex` | `EDIT` | returns a job — slice 2 |
| `GET` | `/pages/{id}/diagnostics` | `VIEW` | indexer diagnostics — slice 2 |

`PUT /pages/{id}` returns the `IndexResult` diagnostics in the response body, so a CI job
that uploads a document learns immediately whether its requirements are valid. This is the
headless path RY cannot offer (research §6.5, `RD-005`). Until slice 2, `diagnostics` is `[]`.

### 3.1 Shapes

Times are ISO-8601 UTC strings. `content` is canonical ProseMirror JSON (`03` §1.4).

```ts
interface UserRef { id: string; name: string }

interface PageSummary {
  id: string; title: string; parentId: string | null; ordinal: number;
  currentVersion: number;           // number of the current version
  lastModifiedAt: string;           // the current version's createdAt
}

interface PageDetail extends PageSummary {
  spaceKey: string;
  ancestors: { id: string; title: string }[];   // root first, excluding the page itself
  createdBy: UserRef; createdAt: string;
  lastModifiedBy: UserRef;
  descendantCount: number;          // how many live pages a delete would take with it
  watching: boolean; favourite: boolean;        // for the caller
  hasDraft: boolean;                // the caller has an unpublished draft
  permissions: { canEdit: boolean; canAdmin: boolean };
}

interface VersionSummary {
  number: number; title: string; message: string | null;
  author: UserRef; createdAt: string;
  current: boolean; pinned: boolean;
  pinnedBy?: number[];              // baseline numbers; absent until slice 13
}
interface VersionDetail extends VersionSummary { content: unknown }

interface GetPageResponse { page: PageDetail; version: VersionDetail }

interface DraftRequest   { title: string; content: unknown; baseVersion: number }
interface DraftResponse  { savedAt: string; stale: boolean; currentVersion: number }
interface Draft          { title: string; content: unknown; baseVersion: number; updatedAt: string;
                           stale: boolean; currentVersion: number }

interface PublishRequest {
  title: string; content: unknown;
  baseVersion: number;              // the version the editor opened from
  message?: string;                 // `What did you change?`, ≤ 500
  notifyWatchers?: boolean;         // recorded, not delivered (RD-061)
  overwrite?: boolean;              // publish over a newer version (RD-055)
}
interface PublishResponse { page: PageDetail; version: VersionSummary; diagnostics: unknown[] }

interface AttachmentRef {
  id: string; filename: string; contentType: string; size: number;
  url: string;                      // /api/v1/attachments/{id}/{filename}
  image: boolean; uploadedBy: UserRef; createdAt: string;
}
```

### 3.2 Errors

RFC 9457 `application/problem+json`: `{ type, title, status, detail, code, ...extras }`.
`type` is `about:blank`; `code` is stable and is what clients branch on.

| `code` | Status | Extras | When |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | | no valid session — never a redirect on `/api` paths |
| `ORIGIN_MISMATCH` | 403 | | state-changing request whose `Origin` is not this host |
| `FORBIDDEN` | 403 | | the caller can see the space but lacks the permission |
| `NOT_FOUND` | 404 | | unknown, malformed, deleted — or **not visible to the caller** (`RD-051`) |
| `VALIDATION` | 422 | `errors: { path, message }[]` | a field is malformed; content failed the schema |
| `TITLE_TAKEN` | 409 | | another live page in the space has that title (`RD-056`) |
| `VERSION_CONFLICT` | 409 | `currentVersion: number` | publish over a newer version without `overwrite` (`RD-055`) |
| `CYCLE` | 409 | | move under itself or a descendant |
| `CURRENT_VERSION` | 409 | | delete of the current version |
| `PINNED_VERSION` | 409 | | delete of a version pinned by a baseline |
| `TOO_LARGE` | 413 | `limit: number` | content over 5 MiB or an attachment over 10 MiB (`RD-063`, `RD-058`) |
| `UNSUPPORTED_MEDIA` | 415 | | a refused attachment type (SVG) or a non-JSON body |

## 4. Baselines

| Method | Path | Notes |
|---|---|---|
| `GET` | `/spaces/{spaceKey}/baselines?expand=details` | |
| `POST` | `/spaces/{spaceKey}/baselines` | `{name, query, reportDocumentId?, includeParentDependencies?}` → DRAFT |
| `POST` | `/spaces/{spaceKey}/baselines/{number}/freeze` | → job |
| `POST` | `/spaces/{spaceKey}/baselines/{number}/refreeze` | `{query, reason}` → job |
| `PATCH` | `/spaces/{spaceKey}/baselines/{number}` | rename only |
| `DELETE` | `/spaces/{spaceKey}/baselines/{number}` | space admin |
| `GET` | `/spaces/{spaceKey}/baselines/{number}/pages` | pinned page versions |

## 5. Analysis

| Method | Path | Notes |
|---|---|---|
| `POST` | `/spaces/{spaceKey}/search/validate` | parse an RQL string, return AST summary or errors — powers editor underlining |
| `POST` | `/spaces/{spaceKey}/traceability` | `MatrixConfig` → page of rows |
| `POST` | `/spaces/{spaceKey}/dependencies` | grid or refusal over the cell cap |
| `POST` | `/spaces/{spaceKey}/coverage` | counts and percentages per relationship/direction |
| `POST` | `/spaces/{spaceKey}/diff` | `DiffRequest` → classified rows |
| `POST` | `/spaces/{spaceKey}/exports` | `{kind, config, format}` → job |

## 5a. Settings and administration

| Method | Path | Notes |
|---|---|---|
| `GET` / `PUT` | `/spaces/{spaceKey}/settings/keys` | key-suggestion settings (`03` §4.2) |
| `GET` / `POST` | `/spaces/{spaceKey}/key-suggestions` | list; add `{prefix, number, suffix}` |
| `DELETE` | `/spaces/{spaceKey}/key-suggestions/{id}` | |
| `POST` | `/spaces/{spaceKey}/reindex` | → job |
| `POST` | `/spaces/{spaceKey}/requirements/rename` | `{selection, prefix, suffix}` → job; permission per `07` §2.4 |
| `GET` / `POST` | `/external-properties` | instance-wide definitions |
| `PATCH` / `DELETE` | `/external-properties/{id}` | type change only — no rename; delete removes all values |
| `GET` / `PUT` | `/admin/settings` | `InstanceSettings` (`01`) |
| `GET` | `/admin/usage` | usage metrics, computed locally |

## 6. Jobs

| Method | Path |
|---|---|
| `GET` | `/jobs/{id}` — state, progress, message, result ref |
| `POST` | `/jobs/{id}/cancel` |
| `GET` | `/jobs/{id}/result` — 302 to the artefact for export jobs |

`GET /jobs?queue=&status=&mine=true` backs both the Queue screen and the Personal queue
(`10` §21); `POST /jobs/{id}/retry` replays a failed job.

Every long operation in this API returns `202` with a job reference. Nothing blocks a
request thread for more than the budget in `07` §5.

## 7. Webhooks

Outbound, per space, HMAC-signed, with delivery retry and a dead-letter view.

Events: `requirement.created`, `requirement.updated`, `requirement.deleted`,
`requirement.renamed`, `dependency.changed`, `validation.failed`, `baseline.frozen`,
`page.indexed`.

Payloads carry the requirement's record id (`SJ/J-026/current`), not just the technical
id, so a consumer can address it back.

## 8. Integrations — explicitly phase 3

Not in v1, but the API above is shaped so they need no redesign:

- **GitHub App** — link requirements to issues, PRs and commits; auto-link on commit
  message keys; a check that fails a PR touching code linked to requirements whose
  validation is `FALSE`. Webhook-driven, both directions.
- **Jira** — the same link model over Jira's REST API. Reqforge does not need RY's
  applink/queue machinery because it is not a Confluence plugin.
- **Test tools** — `hasTest` / `hasLastTest` become live once test results land through
  the `PATCH external-properties` path or a dedicated `test-results` endpoint.
- **ReqIF** — import/export for exchange with external requirements tools.
