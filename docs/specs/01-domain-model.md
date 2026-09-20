# 01 — Domain model

Authoritative schema: [`prisma/schema.prisma`](../../prisma/schema.prisma). This file
explains the *why* and states the invariants the schema cannot express.

## Entities

### User, Group, Session

Reqforge owns authentication, because there is no Confluence to delegate it to. This is
not a Requirement Yogi divergence — RY has no opinion here — so it carries no `RD-` entry.

- `User` — `email` (unique, lower-cased), `name`, `passwordHash` (scrypt, encoded
  `scrypt$<salt>$<hash>`), `isAdmin` for instance-level administration.
- `Group` / `GroupMember` — subjects for permissions alongside users
  (`07-permissions-and-limits.md` §2).
- `Session` — server-side session record (`id`, `userId`, `expiresAt`). The cookie carries
  `<id>.<HMAC(id)>`; expiry and revocation are decided server-side, never by the client.
  A tampered id is rejected before it reaches the database.
- `Membership` — `(space, user | group) → SpacePermission[]`. Effective permissions are the
  **union** of every membership matching the user directly or through one of their groups.

### Space

A container for documents and requirements. Owns: key-suggestion sequences, requirement
types, baselines, saved matrices, permissions.

- `key` — short uppercase identifier, unique globally, `[A-Z][A-Z0-9]{1,15}`.
- `isolated` — when true, cross-space search and cross-space requirement links are
  refused for this space (Requirement Yogi's "Isolate spaces", research §6.6).
- `globalKeys` — when true, requirement keys in this space must be unique across the
  whole installation rather than per space (research §2.2).

### Document

A rich-text specification document owned by a space, stored as ProseMirror JSON.

- `title`, `parentId` (documents form a tree, like a page tree).
- `currentVersionId` → `DocumentVersion`.
- Documents are versioned on every save. Versions are immutable.

**Invariant D1.** A requirement always points at the `DocumentVersion` it was extracted
from, never at the `Document`. This is what makes "show me the document as it was when
baseline 3 was frozen" answerable — the failure mode Requirement Yogi warns about when
Confluence page versions are deleted (research §5.3, leak 3). We never delete versions
referenced by a frozen baseline.

### Requirement

The projection of a marked-up region of a document version.

| Field | Notes |
|---|---|
| `id` | technical PK |
| `spaceId`, `key`, `baselineId` | **the logical identity**; `baselineId = NULL` ⇒ live |
| `upperKey` | denormalised uppercase key for case-insensitive search (research §5.7) |
| `status` | `ACTIVE` \| `ARCHIVED` \| `MOVED` \| `DELETED` |
| `title` | plain text of the Title column / the line containing the marker |
| `bodyHtml` | rendered excerpt for popups |
| `bodySearch` | normalised searchable text — the `text` field of RYQL |
| `originVersionId` | the `DocumentVersion` this was extracted from |
| `anchorPath` | ProseMirror path to the marker node, for deep links |
| `typeId` | nullable → `RequirementType` |
| `newKey`, `newSpaceId` | forwarding pointers when `status = MOVED` |

**Invariant R1.** `UNIQUE (spaceId, upperKey, baselineId)` where NULL baselines collide
— implemented with a partial unique index on `(spaceId, upperKey)` for
`baselineId IS NULL` plus a full unique index including `baselineId`.

**Invariant R2.** Rows with `baselineId IS NOT NULL` are **immutable after freeze**.
Enforced in the repository layer and by a database trigger; there is no update path
through the ORM. The only mutation is a refreeze, which deletes and re-inserts inside one
transaction.

**Invariant R3.** `bodySearch` is the two-representation trick from research §3.7:
`bodyHtml` renders, `bodySearch` matches. List-valued properties serialise so that `=`
behaves as set membership. Getting this wrong makes half the query semantics wrong.

### Property

One row per (requirement, name, value). `kind ∈ {INLINE, EXTERNAL}`.

- `INLINE` values are owned by the document and rewritten on every reindex.
- `EXTERNAL` values are owned by the user and survive reindex, rename and document
  deletion. They are **not** copied into baselines (research §2.6).
- `name` is stored verbatim and additionally as `searchName` — the name with spaces
  removed is *not* what RY does; RY simply says searchable columns cannot contain a
  space. See `RD-011`.
- `valueOrdinal` preserves column order for display; `valueIndex` distinguishes members
  of a list-valued property.

### ExternalPropertyDefinition

Instance-global (research §2.6), not space-scoped: `name`, `dataType ∈ {STRING, NUMBER,
BOOLEAN, DATE, ENUM, TEXT}`, `enumValues`, `description`. Deletion is refused while
values exist.

### Dependency

`(relationship, parentId, childId)` — composite PK, mirroring RY's `DBDEPENDENCY`.

**Invariant P1 — direction.** The requirement whose body *contains* the link is the
**child**; the linked requirement is the **parent** (research §4.1). `TO`/`PARENT`
traverse child → parent; `FROM`/`CHILD` traverse parent → child. Every engineer gets
this backwards once; the tests are named after the doc example (`FN-01` references
`BR-01` ⇒ `BR-01` is a parent of `FN-01`).

**Invariant P2 — dangling survives.** A dependency whose parent does not resolve is kept
as an `UnresolvedDependency` row (`relationship`, `childId`, `targetSpaceKey`,
`targetKey`, `targetBaselineId`) and surfaced on the Broken Links screen. Never
cascade-delete a dependency because its target vanished.

- `targetBaselineId` supports RY's "pin this link to a baseline of the target"
  (research §4.1).

### DocumentLink

Requirement ↔ document-version references that are *not* dependencies: the defining
occurrence and every citing occurrence. `origin: boolean` — true for the defining
occurrence (mirrors RY's `DBLINK.ORIGIN`). Drives the `page`, `pageHistory` and `links`
RYQL fields.

### Baseline

RY has no baseline table (research §5.7) — we must invent one.

| Field | Notes |
|---|---|
| `spaceId`, `number` | sequential per space, assigned at creation, **immutable** |
| `name` | free text, renameable |
| `state` | `DRAFT` \| `FROZEN` |
| `frozenAt`, `frozenById` | |
| `sourceQuery` | the RYQL that selected the members |
| `reportDocumentId` | optional associated summary document |
| `includedDependencies` | whether parent dependencies were pulled in |

**Invariant B1.** A `DRAFT` baseline owns no requirement rows. Freezing is the single
transaction that creates them.

**Invariant B2.** `number` is never reused, including after deletion.

### RequirementType

`spaceId`, `name` (nullable — a nameless type is a bare key suggestion, research §2.3),
`keyPattern`, `locked`, `colour`, `nextSequence`, `preventReusingDeletedKeys`.

Child `RequirementTypeRule` rows: `kind ∈ {REQUIRED_PROPERTY, OPTIONAL_PROPERTY,
REQUIRED_DEPENDENCY}`, `name`, `relationship`, `ordinal`.

Child `RequirementValidation` rows cache results: `requirementId`, `typeId`,
`status ∈ {TRUE, FALSE, WARNING}`, `messages`, `computedAt` — this is what RYQL's
`ruleStatus` reads.

### SavedMatrix

`spaceId`, `name`, `kind ∈ {TRACEABILITY, DEPENDENCY}`, `query`, `columns` (JSON),
`visibility`, `ownerId`. Embeddable into documents by id.

### Job

Durable queue: `kind`, `payload`, `state ∈ {QUEUED, RUNNING, DONE, FAILED, CANCELLED}`,
`progress`, `message`, `error`, `startedAt`, `finishedAt`, `cancelRequested`.

### Audit / History

`RequirementHistory`: `requirementId`, `at`, `actorId`, `changeKind`, `before`, `after`
(JSONB diffs). Off by default per space, like RY (research §2.7), because it is the
most expensive table in the system.

## Identity and addressing

The canonical human-readable address of a requirement is RY's record-ID grammar
(research §2.7):

```
<SPACE>/<KEY>/<baseline-number|current>      e.g.  SJ/J-026/current, SJ/J-026/1
```

URLs: `/s/{spaceKey}/r/{key}` for live, `/s/{spaceKey}/r/{key}@{baselineNumber}` for a
baselined version.

## Invariant summary (these become tests)

| Id | Invariant |
|---|---|
| D1 | Requirements reference a `DocumentVersion`, never a `Document` |
| R1 | `(spaceId, upperKey, baselineId)` is unique, NULLs colliding |
| R2 | Baselined requirement rows are immutable |
| R3 | `bodySearch` is the only field RYQL `text` matches |
| P1 | The requirement containing the link is the **child** |
| P2 | Unresolved dependencies are retained, never deleted |
| B1 | A draft baseline owns no requirement rows |
| B2 | Baseline numbers are never reused |
