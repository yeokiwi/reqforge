# PLAN — Reqforge build order

Vertical slices. Each ships schema + domain + API + UI + tests and is demoable on its own.
No slice is "done" until its acceptance checks pass.

`[lead]` is the agent that drives the slice; `[with]` are the agents it hands off to.
See `docs/team.md`.

---

## Phase 0 — Foundations

### Slice 0 — Walking skeleton
`[lead] platform-engineer` `[with] domain-modeler, test-engineer`

**Status: built** (2026-10-09). Decisions `RD-050` – `RD-054`. Not in this slice, by design:
password reset, SSO, MFA and a shared login throttle (`RD-050`); the page tree, `Create`
and `SPACE SHORTCUTS` content (slices 1 and 16a, `RD-052`).

Next.js App Router + TypeScript strict, Postgres via Docker Compose, Prisma wired,
auth (email + session), a space list, one empty space page. CI running
`pnpm verify` = typecheck + lint + test + `prisma validate`. Playwright smoke test.
Seed script creating two spaces and three users with different permissions.

Also the **application shell from the video** (`10` §2–3): top bar with `Spaces ▾`,
`Create`, `···`, Search, help, settings and avatar; the space sidebar in both its
collapsed icon-rail and expanded states; the copy-deck loader every later slice uses.

**Acceptance:** a fresh clone reaches a logged-in empty space in one command, and CI is
green on a pull request. The shell matches `10` §2–3 element for element, with every
"not built" element absent and every "later" element's slot reserved. Copy-deck tests
run in CI.

### Slice 1 — Documents and the editor shell
`[lead] authoring-engineer` `[with] platform-engineer`

Document tree per space, create/rename/move/delete, TipTap editor with the standard
rich-text schema, immutable `DocumentVersion` on every save, document history view.
No requirements yet.

The GUI is the video's (`10` §4–5): page view with breadcrumb, byline icons, `Edit` ·
`Save for later` · `Watching` · `Share` · `···`; the editor's two-row toolbar with the
table row appearing only inside a table; the footer with `Ready to go` / `Saving
changes` / `Changes saved`, `What did you change?`, `Notify watchers`, `Update`, `Close`;
the `+ ▾` insert menu and `{` Macro suggestions with every v1 item from `10` §5.4–5.5.

**Acceptance:** write a page with tables and lists, reload, see it unchanged; every
save creates a version; the version list renders past versions read-only. The page view
and editor pass the side-by-side review against the 0:18 and 0:46 reference frames.

---

## Phase 1 — Core requirements (v1 scope: core + properties)

### Slice 2 — Requirement markers and the indexer
`[lead] authoring-engineer` `[with] domain-modeler, test-engineer`

The `requirement` node, the three insertion paths (`Alt+Shift+R`, insert menu, `{req`
autocomplete), the four scope layouts (horizontal table, vertical table, paragraph,
**heading**), the pure indexer, requirement rows written on save, the requirement detail
page, the hover popup.

Spec: `03-authoring-and-indexing.md` §1–3, §6.1; `10-ui-reference.md` §4–8.

**Acceptance:** all four indexer contracts (I1–I4) hold under property-based tests;
rules S1–S4 each have a failing-document fixture and a diagnostic; deleting a marker sets
`DELETED` and keeps the row; a requirement in a heading takes the heading text as its
title and records `headingLevel` and `sectionPath`; the popup is one component used by
both the document and the detail page.

### Slice 3 — Keys, patterns, suggestion and bulk creation
`[lead] authoring-engineer` `[with] domain-modeler`

Unicode key validation with its hard and soft rules, key patterns, the multi-pattern
suggestion picker, sequence advance-and-never-rewind, reset action, key locking,
duplicate and conflict handling, the **bulk-insert dialog** and the **view-mode inline
transform**.

Spec: `03` §4, §6.2–6.3.

**Acceptance:** the sequence survives deletion; reset is permission-gated; a key defined
in two documents produces a visible conflict on both, with neither hidden; the picker
offers the next key of every pattern at once; `日本語の文字-001` and `REQ 005` are
accepted, round-trip through a URL, and are queryable, while `REQ/006\` is rejected with
the inline message; a bulk insert that fails validation on any line inserts nothing;
running the inline regex transform twice changes nothing the second time. The key
picker, both bulk-dialog variants and the inline dialog open with exactly the defaults
and copy in `10` §6, and pass side-by-side review against the 0:54, 2:16, 2:30 and 2:40
frames.

**From screencast set 2:** the space **Key suggestions** screen (`10` §18.1) — settings with
RY's defaults (`RD-042`) and the suggestion table with Add, Delete and Search. Extra
acceptance: a suggestion is stored as prefix + padded number + suffix; deleting one makes
the next key follow the highest existing key; *Prevent reusing deleted keys* starts
unticked; the four options are disabled while *Use global settings* is ticked.

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
injection, precedence per RD-018, lexing per RD-019, plus `describe()` and `complete()`
per RD-024.

Spec: `02-query-language.md` §1–4, §8–9.

**Acceptance:** corpus items 1, 3, 4 from `02` §10 all green. Every example query in
`docs/research/requirement-yogi-dc.md` §3.8 parses. Every precedence case has a pinned
English rendering from `describe()`, and the rendering names the injected defaults.

### Slice 6 — RQL: SQL compiler and the search screen
`[lead] ryql-engineer` `[with] platform-engineer, test-engineer`

Parameterised SQL generation for every field and operator, two-valued NULL semantics,
traversal by joins with the depth cap, the Requirements screen with its tab bar, inline
error underlining, `Ctrl+Space` completion, the effective-query echo, the 30-row pager,
Excel and CSV export, saved searches, bulk selection including select-all-matching-query.

Spec: `02` §5–8, §10; `10-ui-reference.md` §9.

**Acceptance:** corpus items 2, 5, 6, 7 green against the 500-requirement fixture
database; no code path builds SQL from user input outside the compiler (enforced by a
lint rule); the echo under the query box names the injected space, status and baseline
scopes in the video's register; the tab bar, hint line, pager line and Links-column
badges match `10` §7 and §9 verbatim, with `Excel` disabled; selecting the header
checkbox selects every match, not the visible page;
p95 budgets in `07` §5 met in CI.

**From screencast set 2:** free-text queries (`02` §3.2) and query history; the newer tab
bar `… Diff · Reports · External properties` (`RD-038`). Extra acceptance: typing `KEY`
echoes *"Requirements containing 'KEY' and …"*; `key ~ 'Business%'` echoes *"…with key
starting with 'Business'…"*; corpus category 8 is green.

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

**From screencast set 2:** the Traceability toolbar exactly as `10` §20 — `Search:` with
Save and `···`, *Built in N ms.*, the edit-mode toggle, `+ Add property` with *Add external
property column*, `›` row expanders — and the Reports tab (`04` §4a). Extra acceptance:
edit mode renders the right input per property type and saves per cell.

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

**From screencast set 2:** the External properties tab (`10` §24) and Administration →
Properties (`10` §19.2). Extra acceptance: only the five types exist (`RD-040`); the name
field is absent from the edit form; deleting a definition reports and removes every value;
INLINE and EXTERNAL counts are correct.

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

**From screencast set 2:** the Baselines tab (`10` §14) and all three creation routes —
wizard from the tab, wizard from Search with the Scope block, instant from the byline
panel (`10` §15, `05` §2.1). Extra acceptance: wizard defaults are *Freeze requirements
now* and *None (simple)*; baselined requirements display as `KEY vN`, sit on grey rows
under *Show all versions* and refuse edits; page history shows `Baseline "<name>" for
Reqforge` on pinned versions with Delete disabled (`RD-041`); only space admins and
permitted groups can delete a baseline (`RD-043`).

### Slice 14 — Diff, `isModified`, history
`[lead] baseline-engineer` `[with] ryql-engineer, test-engineer`

Two-query diff with compare/ignore options, added/removed/modified classification,
word-level and set-level detail, the 600-row limit with an export path, `isModified()` in
RQL sharing the diff's field set, per-space history with retention.

Spec: `05` §5–6.

**Acceptance:** `isModified(N)` and the diff view never disagree on the same pair — a
property-based test asserts exactly that.

**From screencast set 2:** the Diff tab exactly as `10` §16 — `State` column, `Set 2`,
`NON EXISTING`, `Compare ▾`, `Limit (600) ▾`, *Display descriptions* with red strikethrough
and green highlight. Extra acceptance: selecting one baseline on the Baselines tab diffs it
against current; two diffs them against each other; three disables the button.

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

**From screencast set 2:** the rename **page** (`10` §17) and the shared long-running-task
view. Extra acceptance: a non-admin editor is refused unless in a configured rename group;
the result reads *"Reqforge modified {m} macros on {p} pages to rename {r} requirements."*

---

## Phase 6 — Hardening

### Slice 16 — Permissions, restrictions and classification
`[lead] platform-engineer` `[with] all`

Space permissions, document restrictions, rules X1–X4, the mandatory visibility
predicate, classification labels on exports, the audit log.

Spec: `07-permissions-and-limits.md`.

The **Restrictions dialog** reproduces the video (`10` §10): three modes with their
subtitles, the user-or-group entry list, `Everyone — Has no access`, `Apply` disabled
until a change — plus the one added line telling the user that requirements on the page
follow the restriction (`RD-034`).

**Acceptance:** the "no direct table access outside the repository" test passes; every
list surface has a restricted-content test; restricting a page in the dialog removes its
requirements from search, matrices, coverage and the popup for an unlisted user — the
exact scenario the video demonstrates going the other way.

### Slice 16a — Administration, queue and space settings
`[lead] platform-engineer` `[with] domain-modeler, test-engineer`

From screencast set 2. Administration with RY's tab structure (`10` §19): Getting started,
Options (global limit; rename, baseline-deletion and export permissions), Properties, Key
suggestions defaults, Upgrade tasks, Usage metrics. The **Queue** screen and **Personal
queue** over our jobs (`10` §21, `RD-046`). Space settings → Reqforge: Options, Reindex,
Key suggestions, Trash (`10` §18). The deleted-requirement page (`10` §22) and page
history (`10` §23).

Spec: `10` §18–23; `07` §2.4, §4; `RD-043`, `RD-046`, `RD-048`.

**Acceptance:** every Options help text matches the copy deck; a reindex survives closing
the browser and reattaches; failed jobs can be retried from the Queue; the Personal queue
shows only the user's jobs and no settings; usage metrics make no outbound request (a
test asserts no network egress); a requirement inside an expand block is indexed and never
appears on the deleted-requirement page (`RD-047`).

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
| Excel import / round-trip | **Fully specified from the vendor video in `10` §25 (`RD-049`)** — 4,000 per import, per-sheet opt-in, roles KEY · DESCRIPTION · PROPERTY · `-`. Until then, paste into a page and bulk-insert |
| xlsx export of search results | RY's contractual-sign-off bridge |
| ReqIF import/export | Exchange with external requirements tools |
| GitHub App | Auto-link on commit keys; PR check on validation failures |
| Jira integration | Same link model, no applink machinery needed |
| Test sessions | `hasTest` / `hasLastTest` become live |
| Variants | `RD-009` |

---

## GUI review gate

Every slice that touches a screen in `10-ui-reference.md` produces a side-by-side
artefact: our screen at 1920×1080 next to the matching reference frame from the research
note's frame index. `code-reviewer` checks it against question 6 of its brief; a
departure not listed in `10` §0 blocks the merge.

## Working rhythm

One slice in flight at a time, with at most one parallel slice from a different phase
when the lanes do not overlap. Before a slice starts, `spec-keeper` confirms the spec
sections it cites are current. After it ends, `code-reviewer` checks the acceptance list
and `spec-keeper` folds any new decisions into `09-decision-log.md`.
