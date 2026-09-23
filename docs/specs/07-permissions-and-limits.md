# 07 — Permissions, tenancy and limits

## 1. Why this is its own spec

Requirement Yogi inherits Confluence's permissions and, by its own documentation,
**ignores page-level restrictions**: marking a table row as a requirement exports its
text to everyone with space-view permission (research §6.7). For a tool whose entire
purpose is holding the authoritative text of a specification, that is a hole we must not
carry forward.

## 2. Model

Subjects: `User`, `Group`. Objects: `Space`, `Document`, `SavedMatrix`, `Baseline`.

### 2.1 Space permissions

| Permission | Grants |
|---|---|
| `VIEW` | see the space, its documents (subject to §2.2), requirements, search, matrices |
| `EDIT` | create and edit documents, edit external property values, run a type's validation, reset key sequences |
| `EXPORT` | dependency matrix, coverage, xlsx/diff exports, bulk operations |
| `ADMIN` | requirement types, key locking, **renaming requirements**, baselines, history settings, permissions |

`EXPORT` is deliberately separate from `VIEW`, exactly as RY does, because those screens
are the expensive ones (research §4.3).

Renaming sits on `ADMIN` rather than on `EDIT` or on the `EXPORT` bulk-operation rule of
`RD-039`: a key is a requirement's identity, and RY restricts renaming to a global admin
or an explicitly granted group (research §2.8). See `RD-053`.

### 2.2 Document restrictions — the divergence

A document may carry a restriction: `inherit` (default), or an explicit allow-list of
users and groups for `view` and for `edit`.

- **View restrictions inherit down the tree** (`RD-056`). A reader sees a document only if
  its own view list *and* that of every restricted ancestor admit them. `inherit` means "no
  list of its own", never "unrestricted".
- **Edit restrictions do not inherit.** An edit list restricts its own document only, and
  never widens the view list. With no edit grants, every viewer with space EDIT may edit.
- **Who restricts** (`RD-057`): anyone who may currently edit the document. A change that
  would remove the actor's own view or edit access is refused, and so is an explicit
  restriction with nobody on its view list.
- **Administrators** (`RD-058`) have no read bypass. Space ADMIN gets a *Restricted
  documents* screen listing restricted documents by title only, from which a restriction
  can be removed. That is how a document orphaned by a leaver is recovered, and every
  unlock is audited.
- **Hidden reads as missing** (`RD-064`). A requirement or document the caller may not view
  answers exactly like one that does not exist: a 404, never a 403.

**Rule X1.** A restriction on a document propagates to **every requirement defined in
it** and to that requirement's title, body and inline properties, everywhere they would
otherwise appear: search results, matrices, coverage counts, reports, exports, the
popup, and the REST API.

**Rule X2.** A requirement the caller may not view is **omitted, not redacted, and not
counted**. Coverage denominators and result counts reflect only what the caller can see.
A visible requirement that depends on a hidden one shows the dependency as
`restricted` — the existence of a link is not itself secret, its target's content is.

**Rule X3.** Restrictions are enforced in the **repository layer**, by a mandatory
visibility predicate injected into every requirement query including the RQL compiler's
output. There is no code path that reads requirements without it. This is tested by a
test that greps for direct table access outside the repository.

**Rule X4.** A frozen baseline captures the restriction state at freeze time. Loosening a
document's restrictions later does not retroactively expose baselined text; tightening
them does apply to the baseline.

Implementation (`RD-059`): the freeze copies the origin documents' gates and view grants
into the baseline, and a frozen row must pass both the frozen gates and the current ones.

**What "restricted" leaves visible.** A dependency on a hidden requirement keeps its key,
because the existence of a link is not secret. Keys are never treated as secret: key
uniqueness is space-wide. Titles, bodies, properties, citing documents and counts are what
the predicate protects.

**The X3 test.** `tests/architecture.test.ts` checks two things:
- nothing outside `src/server/repositories/` reaches the Prisma client;
- every repository function that reads requirement or document content either applies the
  predicate or carries an `X3-exempt:` comment saying why it is a system read — an indexer
  write, a key-uniqueness check, a job that shows nothing.

`tests/restricted-content.test.ts` walks every list surface.

### 2.3 Classification labels

Spaces and documents may carry a classification label (free text configured per
installation, e.g. `Official (Closed)`). The installation's labels form an **ordered list**
kept by instance administrators (`RD-060`), because "the highest" needs an order. Labels
are:

- displayed in the document header, on every exported file's header/footer, and in the
  xlsx export's first sheet;
- inherited by requirements and by any baseline that includes them;
- **propagated upward**: a document's effective label is the highest of its own and any
  label on content it embeds.

Labels do not by themselves enforce access — restrictions do — but every export carries
the label of the highest-classified content it contains.

Precisely (`RD-060`):
- **Requirement:** the higher of its space's and its origin document's label.
- **Document:** the highest of its own, its space's, and the requirements its links,
  reports and saved matrices render *for the reader looking at it*.
- **Export:** the highest over the space and every row in the file, written into the first
  row and the header and footer of every sheet.
- **Baseline:** the highest over its members, captured at freeze.

## 3. Isolation

`Space.isolated` (research §6.6) refuses cross-space search, cross-space requirement
links and cross-space REST scoping for that space. An isolated space's requirements never
appear in another space's picker.

## 4. Limits

Configured per installation with per-space overrides. Defaults are RY's documented
numbers where they exist, because they were derived from real deployments.

| Limit | Id | Default | Override | Source |
|---|---|---|---|---|
| Requirements per space | `requirementsPerSpace` | 12,000 | any | RY global limit (research §6.7) |
| Requirements per baseline | `requirementsPerBaseline` | 12,000 | any | RY |
| Requirements per document | `requirementsPerDocument` | 400 | any | RY |
| Requirements per document (warning) | `requirementsPerDocumentWarning` | 150 | any | RY |
| Diff rows (interactive) | `diffRows` | 600 | lower-only | RY |
| Requirements compared interactively | `diffInteractiveMax` | 2,000 | lower-only | ours (`05` §5.4) |
| Matrix page size | `matrixPageSizeMax` | 600 | lower-only | RY (100 is the default page) |
| Dependency matrix web cells | `dependencyMatrixCells` | 40,000 | lower-only | RY |
| Dependency matrix export axis | `dependencyExportAxis` | 5,000 | lower-only | RY's tested size (research §4.3) |
| Traversal depth (->) | `traversalDepth` | 4 | fixed | ours (`02` §5.1) |
| Requirements per rename | `renameRequirements` | 2,000 | any | ours (`RD-054`) |
| Documents rewritten per rename | `renameDocuments` | 1,000 | any | ours (`RD-054`) |
| Rules per requirement type | `rulesPerType` | 40 | any | ours |
| Types applying to one document | `typesPerDocument` | 20 | any | RY |
| Import rows per file | `importRows` | 5,000 | fixed | ours — RY's docs conflict (2,000 vs 12,000) |

Exceeding a hard limit is an error with the limit named in the message. Exceeding a
warning threshold is a diagnostic, not a block.

- **Where values come from (`RD-071`):**
  - the spec default above;
  - then the installation's `REQFORGE_LIMITS` environment variable, a JSON object of ids to
    numbers;
  - then the space's overrides, which only an instance administrator sets, on
    `/admin/limits`, audited.
- **Override classes:**
  - `any` limits move either way;
  - `lower-only` limits guard a code path sized for the default, such as the compiler's
    600-row page and the 200 × 200 grid, so they may be tightened but never raised;
  - `fixed` limits are part of a contract that needs a decision-log entry to change.
  - A warning threshold must stay below its hard limit.
- **The error:** `LimitExceededError`, `422`, code `LIMIT_EXCEEDED`. Its message reads
  `"<Limit>" limit exceeded: <what>; the limit is <n>.` The problem details carry
  `limitName` (the id), `limit` and `actual`.
- **Where each document and space limit is checked (`RD-072`):**
  - Requirements per document and types per document are checked on save and reindex,
    **before anything is written**. The save is refused, and the editor keeps the unsaved
    content.
  - Crossing the warning threshold saves normally, with a `DOCUMENT_LARGE` warning.
  - Requirements per space is checked inside the save's transaction. Only a save that
    *adds* live requirements is refused, so a space already over a lowered limit can still
    be edited and shrunk.

## 5. Performance budget

RY's stated cost at 50,000 requirements is ~20 ms per requirement on save and on view
(research §6.7). Ours, measured on the fixture dataset in CI:

| Operation | Budget |
|---|---|
| Index one document (100 requirements) | < 300 ms |
| Search, 100 rows, simple query | < 150 ms p95 |
| Search, 100 rows, one `->` traversal | < 400 ms p95 |
| Traceability matrix page, 100 rows, 8 columns | < 600 ms p95 |
| Coverage over 5,000 requirements | < 2 s p95 |
| Freeze 5,000 requirements | < 60 s, streaming |

CI fails on a >25% regression against the recorded baseline for any of these.

How it is measured (`RD-073`):

- **Fixture.** `tests/perf/scale-fixture.ts` builds 50,000 live requirements in five
  spaces of 10,000, with ~10 properties and ~3 dependencies each, in documents of 100, two
  of them restricted per space.
- **Method.**
  - Each operation is measured through its use case, as the perf user.
  - Budgets are judged on p95.
  - The regression is judged on the median against the recorded baseline's median. p95
    moves too much between identical runs to hold a 25% line.
- **Running it.**
  - `pnpm perf` builds or reuses the fixture, measures and gates. It is not part of
    `pnpm verify`, and CI runs it as its own job.
  - `pnpm perf:record` records the current environment's baseline in
    `tests/perf/baseline.json`, keyed by `PERF_ENV`, default `local`. An environment with no
    baseline is gated on the budgets alone.

## 6. Auditability

Every state-changing operation writes an audit row: actor, at, object, operation,
parameters. Audit rows are append-only and are never pruned by the history retention
policy. Freeze, refreeze, rename, restriction change, permission change and export are
the operations an auditor will ask about, and each must be reconstructable from the
audit log alone.

`RD-062` lists what is audited:
- those six, with an export audited when queued and again when downloaded;
- group membership, classification levels and labels;
- requirement types and key-sequence resets;
- history settings and prunes;
- external property definitions;
- document move and delete, and baseline rename and row discard.

Document saves are not duplicated: they are immutable versions with an author. Space
ADMIN reads the log on an *Audit log* screen.

Only the person who queued an export may download it (`RD-062`), because the file holds
what they could see.

A rename therefore writes **one** row for the whole batch, with `objectType: 'Requirement'`
and `parameters` carrying every `{from, to}` pair together with the counts of documents and
saved queries rewritten — the mapping itself, never a count of it. It is written inside the
rename's transaction, so a rename that rolled back leaves no audit row claiming it
happened.
