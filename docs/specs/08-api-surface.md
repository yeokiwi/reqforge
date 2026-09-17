# 08 — REST API

Requirement Yogi's API is explicitly experimental, and most of its write endpoints are
documented as "Do not use" (research §6.5). Ours is a first-class product surface: the
integrations we care about (CI pipelines, test tools, GitHub) are API-only.

## 1. Conventions

- Base path `/api/v1`. Versioned; `v1` is stable once slice 8 ships.
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

## 3. Documents

| Method | Path | Notes |
|---|---|---|
| `GET` | `/spaces/{spaceKey}/documents` | tree |
| `GET` | `/spaces/{spaceKey}/documents/{id}?version=` | ProseMirror JSON or `?format=html` |
| `POST` | `/spaces/{spaceKey}/documents` | create |
| `PUT` | `/spaces/{spaceKey}/documents/{id}` | new version; triggers synchronous indexing |
| `POST` | `/spaces/{spaceKey}/documents/{id}/reindex` | returns a job |
| `GET` | `/spaces/{spaceKey}/documents/{id}/diagnostics` | indexer diagnostics |

`PUT` returns the `IndexResult` diagnostics in the response body, so a CI job that
uploads a document learns immediately whether its requirements are valid. This is the
headless path RY cannot offer (research §6.5, `RD-005`).

## 4. Baselines

| Method | Path | Notes |
|---|---|---|
| `GET` | `/spaces/{spaceKey}/baselines?expand=details` | |
| `POST` | `/spaces/{spaceKey}/baselines` | `{name, query, reportDocumentId?, includeParentDependencies?}` → DRAFT |
| `POST` | `/spaces/{spaceKey}/baselines/{number}/freeze` | → job |
| `POST` | `/spaces/{spaceKey}/baselines/{number}/refreeze` | `{query, reason}` → job |
| `PATCH` | `/spaces/{spaceKey}/baselines/{number}` | rename only |
| `DELETE` | `/spaces/{spaceKey}/baselines/{number}` | space admin |
| `GET` | `/spaces/{spaceKey}/baselines/{number}/documents` | pinned versions |

## 5. Analysis

| Method | Path | Notes |
|---|---|---|
| `POST` | `/spaces/{spaceKey}/search/validate` | parse an RQL string, return AST summary or errors — powers editor underlining |
| `POST` | `/spaces/{spaceKey}/traceability` | `MatrixConfig` → page of rows |
| `POST` | `/spaces/{spaceKey}/dependencies` | grid or refusal over the cell cap |
| `POST` | `/spaces/{spaceKey}/coverage` | counts and percentages per relationship/direction |
| `POST` | `/spaces/{spaceKey}/diff` | `DiffRequest` → classified rows |
| `POST` | `/spaces/{spaceKey}/exports` | `{kind, config, format}` → job |

## 6. Jobs

| Method | Path |
|---|---|
| `GET` | `/jobs/{id}` — state, progress, message, result ref |
| `POST` | `/jobs/{id}/cancel` |
| `GET` | `/jobs/{id}/result` — 302 to the artefact for export jobs |

Every long operation in this API returns `202` with a job reference. Nothing blocks a
request thread for more than the budget in `07` §5.

## 7. Webhooks

Outbound, per space, HMAC-signed, with delivery retry and a dead-letter view.

Events: `requirement.created`, `requirement.updated`, `requirement.deleted`,
`requirement.renamed`, `dependency.changed`, `validation.failed`, `baseline.frozen`,
`document.indexed`.

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
