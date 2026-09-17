# PLAN — Reqforge build order

Vertical slices. Each ships schema + domain + API + UI + tests and is demoable on its own.
No slice is "done" until its acceptance checks pass.

`[lead]` is the agent that drives the slice; `[with]` are the agents it hands off to.
See `docs/team.md`.

---

## Phase 0 — Foundations

### Slice 0 — Walking skeleton
`[lead] platform-engineer` `[with] domain-modeler, test-engineer`

Next.js App Router + TypeScript strict, Postgres via Docker Compose, Prisma wired,
auth (email + session), a space list, one empty space page. CI running
`pnpm verify` = typecheck + lint + test + `prisma validate`. Playwright smoke test.
Seed script creating two spaces and three users with different permissions.

**Acceptance:** a fresh clone reaches a logged-in empty space in one command, and CI is
green on a pull request.

### Slice 1 — Documents and the editor shell
`[lead] authoring-engineer` `[with] platform-engineer`

Document tree per space, create/rename/move/delete, TipTap editor with the standard
rich-text schema, immutable `DocumentVersion` on every save, document history view.
No requirements yet.

**Acceptance:** write a document with tables and lists, reload, see it unchanged; every
save creates a version; the version list renders past versions read-only.

---

## Phase 1 — Core requirements (v1 scope: core + properties)

### Slice 2 — Requirement markers and the indexer
`[lead] authoring-engineer` `[with] domain-modeler, test-engineer`

The `requirement` node, `Alt+Shift+R` insertion, the three scope layouts (horizontal
table, vertical table, paragraph), the pure indexer, requirement rows written on save,
the requirement detail page, the hover popup.

Spec: `03-authoring-and-indexing.md` §1–3.

**Acceptance:** all four indexer contracts (I1–I4) hold under property-based tests;
rules S1–S4 each have a failing-document fixture and a diagnostic; deleting a marker sets
`DELETED` and keeps the row.

### Slice 3 — Keys, patterns and suggestion
`[lead] authoring-engineer` `[with] domain-modeler`

Key validation, key patterns, next-key suggestion, sequence advance-and-never-rewind,
reset action, key locking, duplicate and conflict handling.

Spec: `03` §4.

**Acceptance:** the sequence survives deletion; reset is permission-gated; a key defined
in two documents produces a visible conflict on both, with neither hidden.

### Slice 4 — Inline properties
`[lead] authoring-engineer` `[with] platform-engineer`

The `propertyConfig` node, column-header property names, title column selection, ignored
columns, list-valued cells, `bodySearch` normalisation, properties in the popup and the
requirement page.

Spec: `03` §1.3, §3.1; `01` (Property).

**Acceptance:** invariant R3 pinned by tests — a list cell matches `=` by membership; a
property name with a space produces the `PROPERTY_NAME_NOT_SEARCHABLE` warning and is
still queryable with the quoted form.

---

## Phase 2 — Query (v1 scope: search syntax engine)

### Slice 5 — RQL: lexer, parser, analyser
`[lead] ryql-engineer` `[with] test-engineer`

Pure front end of the query pipeline. AST, typed errors with offsets, default-scope
injection, precedence per RD-018, lexing per RD-019.

Spec: `02-query-language.md` §1–4, §8–9.

**Acceptance:** corpus items 1, 3, 4 from `02` §10 all green. Every example query in
`docs/research/requirement-yogi-dc.md` §3.8 parses.

### Slice 6 — RQL: SQL compiler and the search screen
`[lead] ryql-engineer` `[with] platform-engineer, test-engineer`

Parameterised SQL generation for every field and operator, two-valued NULL semantics,
traversal by joins with the depth cap, the search UI with inline error underlining,
saved searches, bulk selection including select-all-matching-query.

Spec: `02` §5–7, §10.

**Acceptance:** corpus items 2, 5, 6 green against the 500-requirement fixture database;
no code path builds SQL from user input outside the compiler (enforced by a lint rule);
p95 budgets in `07` §5 met in CI.

---

## Phase 3 — Traceability (v1 scope: traceability + coverage)

### Slice 7 — Dependencies
`[lead] traceability-engineer` `[with] authoring-engineer`

The `requirementLink` node, relationship naming from column headers, direction rule
(invariant P1), dependency indexing, unresolved-dependency retention, the Broken Links
screen, dependencies in the popup.

Spec: `03` §1.2; `04` §1; `01` (Dependency).

**Acceptance:** the `FN-01`/`BR-01` direction test from `01` P1 is written first and
passes; deleting a target leaves an `UnresolvedDependency` row, never a cascade delete.

### Slice 8 — Traceability matrix
`[lead] traceability-engineer` `[with] platform-engineer`

Row query, configurable columns, tree view, pagination, saved matrices with visibility,
embedding in documents, `$currentBaseline` resolution, two-phase fetching, xlsx export
as a job.

Spec: `04` §2.

**Acceptance:** no N+1 under a query counter; a matrix with 8 columns over 100 rows meets
the budget; a saved matrix embedded in two documents renders correctly in both.

### Slice 9 — Dependency matrix and coverage
`[lead] traceability-engineer` `[with] platform-engineer`

The grid with the 40,000-cell cap, xlsx export with two sheets and frozen panes, coverage
counts and percentages per relationship and direction, clickable figures, the uncovered
list, per-space coverage thresholds.

Spec: `04` §3–4.

**Acceptance:** cap refusal offers the export instead of failing; coverage denominators
respect visibility (rule X2) and a test proves two users with different access see
different, internally-consistent numbers.

### Slice 10 — Reports
`[lead] traceability-engineer`

The `report` block node, the columns mini-syntax, `countOnly`, "last requirement"
semantics, the recursion guard, the >5-reports warning.

Spec: `04` §5.

---

## Phase 4 — External properties and types

### Slice 11 — External properties
`[lead] domain-modeler` `[with] traceability-engineer, platform-engineer`

Instance-global definitions with data types, per-requirement values, admin screen,
editing in the matrix, bulk set across a result set, the five aggregations, `*` marking
in the popup, `ext@` in RQL.

Spec: `01` (Property, ExternalPropertyDefinition); `04` §2.2.

**Acceptance:** external values survive reindex, rename and document deletion.

### Slice 12 — Requirement types and validation
`[lead] domain-modeler` `[with] authoring-engineer`

Types, rules including `PROPERTY_IN` and `PROPERTY_MATCHES`, validation on index and on
type change, cached results, `ruleStatus` in RQL, red/yellow pills, quick fixes,
templates.

Spec: `06-requirement-types.md`.

**Acceptance:** validating one requirement issues zero extra queries (query-counter test);
a type edit revalidates the space through a job with progress.

---

## Phase 5 — Baselines (v1 scope: baselines & versioning)

### Slice 13 — Baselines: draft and freeze
`[lead] baseline-engineer` `[with] domain-modeler, platform-engineer`

Draft creation from a query or a document, sequential numbering, the freeze job with
batching and progress, member closure over parent dependencies, document-version pinning,
image materialisation, the database-level immutability trigger, the baseline report
document, instant baselines.

Spec: `05-baselines-and-diff.md` §1–4.

**Acceptance:** invariants B1, B2 and R2 tested — R2 by attempting an update through raw
SQL and expecting the trigger to reject it; a pinned document version cannot be deleted;
a frozen body's images resolve after the source image is replaced.

### Slice 14 — Diff, `isModified`, history
`[lead] baseline-engineer` `[with] ryql-engineer, test-engineer`

Two-query diff with compare/ignore options, added/removed/modified classification,
word-level and set-level detail, the 600-row limit with an export path, `isModified()` in
RQL sharing the diff's field set, per-space history with retention.

Spec: `05` §5–6.

**Acceptance:** `isModified(N)` and the diff view never disagree on the same pair — a
property-based test asserts exactly that.

### Slice 15 — Renaming
`[lead] authoring-engineer` `[with] baseline-engineer, platform-engineer`

Single and batch rename, prefix/middle/suffix decomposition with live preview,
propagation across documents, dependencies, external properties and saved queries, the
transactional job with cancel and acknowledge, `renamedFrom` chains, baselined rows
untouched.

Spec: `03` §5.

**Acceptance:** an induced failure mid-rename leaves zero modifications (RY's "No
modification was saved"); a baselined requirement keeps its original key and still
resolves from the renamed live one.

---

## Phase 6 — Hardening

### Slice 16 — Permissions, restrictions and classification
`[lead] platform-engineer` `[with] all`

Space permissions, document restrictions, rules X1–X4, the mandatory visibility
predicate, classification labels on exports, the audit log.

Spec: `07-permissions-and-limits.md`.

**Acceptance:** the "no direct table access outside the repository" test passes; every
list surface has a restricted-content test.

### Slice 17 — REST API and webhooks
`[lead] platform-engineer` `[with] ryql-engineer`

`/api/v1`, API tokens, generated OpenAPI, jobs endpoints, webhooks with HMAC and retry.

Spec: `08-api-surface.md`.

### Slice 18 — Performance and limits
`[lead] test-engineer` `[with] all`

The fixture dataset at scale, the CI performance budgets, limit enforcement with named
errors, the >25% regression gate.

Spec: `07` §4–5.

---

## Phase 7 — Backlog (not v1)

Not scheduled. Listed so nobody designs them out by accident.

| Item | Notes |
|---|---|
| Word import | RY has no importer at all (research §6.1); a real one is a differentiator |
| Excel import / round-trip | Column-mapping UI, the five roles, schema-drift abort |
| xlsx export of search results | RY's contractual-sign-off bridge |
| ReqIF import/export | Exchange with external requirements tools |
| GitHub App | Auto-link on commit keys; PR check on validation failures |
| Jira integration | Same link model, no applink machinery needed |
| Test sessions | `hasTest` / `hasLastTest` become live |
| Variants | `RD-009` |

---

## Working rhythm

One slice in flight at a time, with at most one parallel slice from a different phase
when the lanes do not overlap. Before a slice starts, `spec-keeper` confirms the spec
sections it cites are current. After it ends, `code-reviewer` checks the acceptance list
and `spec-keeper` folds any new decisions into `09-decision-log.md`.
