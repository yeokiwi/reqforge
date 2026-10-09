# 01 — Domain model

Authoritative schema: [`prisma/schema.prisma`](../../prisma/schema.prisma). This file
explains the *why* and states the invariants the schema cannot express.

## Entities

### Space

A container for documents and requirements. Owns: key-suggestion sequences, requirement
types, baselines, saved matrices, permissions.

- `key` — short uppercase identifier, unique globally, `[A-Z][A-Z0-9]{1,15}`.
- `isolated` — when true, cross-space search and cross-space requirement links are
  refused for this space (Requirement Yogi's "Isolate spaces", research §6.6).
- `globalKeys` — when true, requirement keys in this space must be unique across the
  whole installation rather than per space (research §2.2).
- Key-suggestion settings (`03` §4.2), each with RY's default: `useGlobalKeySettings`
  (true), `linksAcrossSpaces` (true), `preventReusingDeletedKeys` (false), `globalKeys`
  (false), `lockKeys` (false). While `useGlobalKeySettings` is true the instance values
  apply and the space's own are ignored.

### InstanceSettings

One row. The Administration → Options screen (`10` §19.1): `globalLimit` (12000),
`renameGroups`, `baselineDeletionGroups` (comma-separated group names, empty by
default), `exportForAllViewers` (true), plus the instance-level key-suggestion defaults.

### User, Group, Membership, Session

- `User`: `email` (stored lower-cased — a `CHECK` enforces it), `name`, `passwordHash`
  (scrypt, `RD-050`), `isInstanceAdmin`, `sidebarCollapsed` (the sidebar's `«` / `»` state,
  remembered per user, `10` §3.2).
- `Group` / `GroupMember`: named sets of users; a group can hold a space membership.
- `Membership`: grants a set of `SpacePermission`s in one space to **exactly one** subject — a
  user or a group (`CHECK`), at most one row per subject per space (partial unique indexes).
  How rows combine is `07` §2.1 and `RD-051`.
- `Session`: `tokenHash` (SHA-256 of the cookie value; the token itself is never stored),
  `userId`, `expiresAt` — fixed lifetime, no renewal (`RD-050`).
- `UserSpaceState`: per user and space, the star (`favourite`) and `lastViewedAt`, which
  feeds the `Spaces ▾` menu (`10` §2).

### KeySuggestion

`spaceId`, `prefix`, `number` (string — its length is the zero padding), `suffix`.
Unique on `(spaceId, prefix, suffix)`. `number` is the **last used** number and only
advances (`03` §4.2). Deleting a row is allowed; the next key is then recomputed from the
highest existing requirement key with that prefix and suffix.

### Document

A rich-text specification document owned by a space, stored as ProseMirror JSON. The UI
calls it a *page* (`RD-032`).

- `title` — unique per space among live documents, case-insensitively (`RD-056`). Case is
  folded with the ICU root collation (`lower(title COLLATE "und-x-icu")`), so the rule holds
  for every script and does not depend on the cluster's locale (`RD-070`). Writers store
  `normalizeTitle` output (NFC, trimmed).
- `parentId`, `ordinal` — documents form a tree like a page tree; siblings are ordered by a
  dense `ordinal`. A parent is in the same space, the tree has no cycles, no page with
  children changes space, and no page sits more than 1,000 levels deep (all enforced by one
  trigger, `RD-070`).
- `currentVersionId` → `DocumentVersion`, never deletable while current (`ON DELETE
  RESTRICT`) and always one of the document's own versions (trigger).
- `createdById`; `deletedAt`, `deletedById`, `deletedRootId` — soft delete takes the whole
  subtree and records the page the user actually deleted (`RD-056`).
- Versioned on every **Update**, not on every autosave (`RD-055`).

**Invariant D1.** A requirement always points at the `DocumentVersion` it was extracted
from, never at the `Document`. This is what makes "show me the document as it was when
baseline 3 was frozen" answerable — the failure mode Requirement Yogi warns about when
Confluence page versions are deleted (research §5.3, leak 3). We never delete versions
referenced by a frozen baseline.

**Invariant D2.** A `DocumentVersion` is immutable: only `pinned` may change after insert,
and a pinned version cannot be deleted — including by a cascading delete of its document.
Both are enforced by a trigger, so no code path, ORM or raw SQL, can rewrite history.

### DocumentVersion

`documentId`, `number` (sequential per document, never reused because the current version is
never deleted), `title` (as of this version), `content` (canonical ProseMirror JSON,
`03` §1.5), `authorId`, `message` (the change note, ≤ 500), `pinned`, `createdAt`.

### DocumentDraft

`(documentId, userId)` → `title`, `content`, `baseVersionNumber`, `updatedAt`. Mutable
autosave state, **not history**: one per user per document, replaced on every autosave,
deleted by Update or by *Revert to last published*. It is *stale* when `baseVersionNumber`
no longer equals the current version's number (`RD-055`).

### DocumentWatch, DocumentFavourite, DocumentPresence, Attachment

Per-user `Watching` and `Save for later` (`RD-061`); the presence heartbeat table
(`RD-062`); and `Attachment` — `filename`, `contentType`, `size`, `sha256`, `data`,
`uploadedById`, `deletedAt` — bytes in the database, content-addressed, at most 10 MiB,
immutable except for `deletedAt` (`RD-058`). The database checks that `sha256` equals the
hash of `data`, so a row cannot claim another file's hash (`RD-070`).

### Requirement

The projection of a marked-up region of a document version.

| Field | Notes |
|---|---|
| `id` | technical PK |
| `spaceId`, `key`, `baselineId` | **the logical identity**; `baselineId = NULL` ⇒ live |
| `upperKey` | denormalised **Unicode case-folded** key for case-insensitive search (research §5.7). Not `toUpperCase()` — keys may be CJK, Arabic or contain ß and ı (`03` §4.1) |
| `status` | `ACTIVE` \| `ARCHIVED` \| `MOVED` \| `DELETED` |
| `title` | plain text of the Title column / the line containing the marker |
| `bodyHtml` | rendered excerpt for popups |
| `bodySearch` | normalised searchable text — the `text` field of RYQL |
| `originVersionId` | the `DocumentVersion` this was extracted from |
| `anchorPath` | ProseMirror path to the marker node, for deep links |
| `layout` | `TABLE_ROW` \| `TABLE_COLUMN` \| `PARAGRAPH` \| `HEADING` (`03` §2) |
| `headingLevel` | 1–6 when `layout = HEADING`, else null |
| `sectionPath` | ordered heading titles enclosing this requirement — free document structure, kept rather than discarded (`RD-026`) |
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
- `name` is stored verbatim and additionally as `searchName`. RY says searchable columns
  cannot contain a space, yet the video shows a live external property named
  `Estimate (Max)` — with a space *and* parentheses. Both are true: such names exist and
  display fine, they are just awkward to query. We store the real name and make it
  queryable through the quoted form. See `RD-011`.
- `valueOrdinal` preserves column order for display; `valueIndex` distinguishes members
  of a list-valued property.

### ExternalPropertyDefinition

Instance-global (research §2.6), not space-scoped: `name`, `dataType`, `dropdownValues`,
`description`.

`dataType` takes exactly the five types the screencasts show (videos-2 §4.1, §4.8):

| Code | Admin label | Stored and compared as |
|---|---|---|
| `STRING` | Text | text |
| `FLOAT` | Decimal number | numeric — aggregations (`04` §2.1) apply |
| `INTEGER` | Integer | numeric |
| `BOOLEAN` | Boolean | true / false; renders as a checkbox in edit mode |
| `DROPDOWN` | Dropdown | one of `dropdownValues` |

- **The name is immutable** after creation — *"Once created, it is not possible to rename
  external properties."* (`RD-040`)
- The type can change; values that do not convert are kept as text and flagged.
- **Deleting a definition deletes every value of it, instance-wide**, after a
  confirmation that states the count — *"It is possible to delete them entirely, with
  their values."* This replaces the earlier rule that refused deletion while values
  existed.
- No limit on the number of definitions.

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
`keySuggestionId` → `KeySuggestion`, `colour`. Lock and reuse settings live on the
space, not the type (`03` §4.2).

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

URLs follow RY's shape (`RD-029`): `/requirements/{SPACE}/{KEY}` for live,
`/requirements/{SPACE}/{KEY}/{baselineNumber}` for a baselined version, displayed as `KEY vN` (`RD-044`). Keys are
percent-encoded; the full URL table is in `10-ui-reference.md` §11.

## Invariant summary (these become tests)

| Id | Invariant |
|---|---|
| D1 | Requirements reference a `DocumentVersion`, never a `Document` |
| D2 | A `DocumentVersion` is immutable except `pinned`; a pinned one cannot be deleted |
| R1 | `(spaceId, upperKey, baselineId)` is unique, NULLs colliding |
| R2 | Baselined requirement rows are immutable |
| R3 | `bodySearch` is the only field RYQL `text` matches |
| P1 | The requirement containing the link is the **child** |
| P2 | Unresolved dependencies are retained, never deleted |
| B1 | A draft baseline owns no requirement rows |
| B2 | Baseline numbers are never reused |
