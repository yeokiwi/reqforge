# 08 — REST API

Requirement Yogi's API is explicitly experimental, and most of its write endpoints are
documented as "Do not use" (research §6.5). Ours is a first-class product surface: the
integrations we care about (CI pipelines, test tools, GitHub) are API-only.

## 1. Conventions

- Base path `/api/v1`. Versioned; `v1` is stable once slice 8 ships.
- Auth: session cookie for the app; **API tokens** (scoped, per user, revocable) for
  machines. Bearer header.
  - A token is `rf_<id>_<secret>`, shown once at creation on `/settings/tokens`. Only a
    hash of the secret is stored.
  - Scopes are a subset of `read`, `edit`, `export` and `admin`, mapping to VIEW, EDIT,
    EXPORT and ADMIN. `read` is implied by any other scope. A token may also be confined to
    a list of space keys; any other space answers 404, as an unknown space does.
  - A request is authorised against the **intersection** of the token's scopes and its
    owner's live permissions, so a token never does more than its owner and loses what
    they lose. Tokens never act as instance administrator and cannot manage tokens
    (`RD-065`).
  - A request carrying a bearer header that fails authentication is 401. It never falls
    back to the cookie.
  - A cookie-authenticated request that is not `GET`/`HEAD` must carry an `Origin` equal
    to the app's own, or it is refused with 403 (`RD-069`).
- Every endpoint enforces the same permission and visibility rules as the UI
  (`07-permissions-and-limits.md`, rule X3). There is no privileged API path.
- Errors: RFC 9457 problem details (`application/problem+json`) with `type`, `title`,
  `status`, `detail` and a stable `code` (`NOT_FOUND`, `FORBIDDEN`, `BAD_REQUEST`, …).
  - Query failures are `400` with code `QUERY_INVALID` and the RQL error shape from `02` §9
    embedded as `errors`.
  - A request failing its schema is `400 BAD_REQUEST` with the schema `issues`.
- Pagination: `?limit` (default 50, max 600) and an opaque `?cursor`. Never offset.
  - A requirement list's cursor is the `(upperKey, id)` of the last row returned, so a page
    neither skips nor repeats a row when rows are inserted between pages (`RD-068`).
  - A cursor that does not decode is `422`.
- All list responses carry `total` only when it is cheap; otherwise `hasMore` and
  `nextCursor`. An RQL result never carries `total` (`RD-068`).
- OpenAPI 3.1 document served at `/api/v1/openapi.json` and generated **from the route
  handlers**, not hand-written. Each route declares zod schemas for its params, query, body
  and response; the document is built from them, and the tests fail if a route file, the
  registry and the tables below disagree.
- Webhook payloads and requirement responses address a requirement by its record id:
  `SPACE/KEY/current`, or `SPACE/KEY/<baseline number>` for a frozen row (`05` §4).

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
| `POST` | `/spaces/{spaceKey}/documents/{id}/reindex` | returns a job; re-indexes the current version, writing no new version (`RD-070`) |
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
| `GET` | `/jobs/{id}/artifact` — the artefact itself; the download is audited here, once |

Only the person who queued a job can see it (`RD-062`); anyone else gets 404.

The traceability matrix pages its root rows by an opaque position cursor. The matrix is
already bounded to 600 roots per page, and its column set is computed per page, so keyset
paging buys it nothing (`RD-068`).

Every long operation in this API returns `202` with a job reference. Nothing blocks a
request thread for more than the budget in `07` §5.

## 7. Webhooks

Outbound, per space, HMAC-signed, with delivery retry and a dead-letter view.

Events: `requirement.created`, `requirement.updated`, `requirement.deleted`,
`requirement.renamed`, `dependency.changed`, `validation.failed`, `baseline.frozen`,
`document.indexed`.

Payloads carry the requirement's record id (`SJ/J-026/current`), not just the technical
id, so a consumer can address it back.

### 7.1 Payload (`RD-066`)

Identifiers only, and never a title, body or property value. A consumer fetches content
through this API with its own token, which applies rule X3.

```json
{
  "id": "5f0c2a3e-…",
  "type": "requirement.renamed",
  "space": "SJ",
  "recordId": "SJ/J-027/current",
  "key": "J-027",
  "actorId": "…",
  "occurredAt": "2026-09-23T10:00:00.000Z",
  "data": { "previousKey": "J-026", "documentId": "…" }
}
```

What each event fires on:
- `requirement.created`, `requirement.deleted` and `document.indexed` fire on each save
  or reindex.
- `requirement.updated` fires on a save only when the requirement actually changed; an
  unchanged re-save is quiet.
- `dependency.changed` fires when a requirement's declared edges change.
- `validation.failed` fires when a status *becomes* `FALSE`, on save or during type
  revalidation.
- `requirement.renamed` carries `data.previousKey`.
- `baseline.frozen` fires when the freeze job ends, with `data.baselineNumber`.

### 7.2 Delivery (`RD-067`)

- Events are written to an outbox **in the transaction that made the change**, so a
  rolled-back change emits nothing. A space with no subscriber writes nothing.
- Each delivery is a `POST` of the JSON body carrying:
  - `X-Reqforge-Event`, `X-Reqforge-Delivery` and `X-Reqforge-Timestamp`;
  - `X-Reqforge-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>`.

  The secret (`whsec_…`) is shown once, at subscription.
- The URL must be `http(s)`, carry no credentials, and never resolve to a non-public
  address. It is checked at subscription and again at every delivery, because DNS moves.
  Redirects are not followed. A receiver has 10 s to answer.
- Any 2xx is delivered. Anything else is retried after 1 min, 5 min, 30 min, 2 h and
  12 h. After the sixth failed attempt the delivery is `DEAD` and lists in the dead letters
  on the space's **Webhooks** admin screen, where it can be redelivered.

### 7.3 Management (space ADMIN, audited)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/spaces/{spaceKey}/webhooks` | subscriptions with pending / delivered / dead counts |
| `POST` | `/spaces/{spaceKey}/webhooks` | `{url, events?}` → the secret, once |
| `DELETE` | `/spaces/{spaceKey}/webhooks/{id}` | |
| `GET` | `/spaces/{spaceKey}/webhooks/{id}/deliveries?state=` | `PENDING`, `DELIVERED` or `DEAD` |
| `POST` | `/spaces/{spaceKey}/webhooks/deliveries/{id}/redeliver` | a `DEAD` delivery back to `PENDING` with a fresh schedule, due now |

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
