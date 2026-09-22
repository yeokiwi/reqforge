# 05 — Baselines, freeze, diff, history

## 1. What a baseline is

A named, numbered, immutable snapshot of a set of requirements at a point in time. It is
the artefact you attach to a contract, a design review or a certification package, so
the bar for integrity is higher than anywhere else in the system.

Requirement Yogi implements a baseline as **row duplication in the requirement table
with a baseline discriminator** (research §5.7), and we copy that exactly — it is why a
baselined requirement can be queried, traced and reported on by the same engine as a live
one.

## 2. Lifecycle

```
            create                 freeze                      refreeze
   (none) ─────────▶ DRAFT ──────────────────▶ FROZEN ◀────────────────┐
                       │                          │                    │
                       └──── delete ──────────────┴──── delete ────────┘
```

**DRAFT** — the baseline exists, has a number, a name, a source query and optionally a
report document. It owns **no requirement rows** (invariant B1). Members are computed
live from the query, so the draft preview changes as the documents change. That is the
point: you assemble the scope, then freeze when it is agreed.

**FROZEN** — one transaction materialises the member rows. From then on those rows are
immutable (invariant R2).

**Instant baseline** — creation and freeze in one action, scoped to a single document,
with no report document. RY's fourth creation path (research §5.1).

## 3. Freeze

### 3.1 Inputs

```ts
type FreezePlan = {
  baselineId: string;
  query: string;                    // RQL selecting members
  includeParentDependencies: boolean;
  fields: {                         // what gets copied
    title: true; body: true; inlineProperties: true;
    dependencies: true;             // among members
    externalProperties: boolean;    // RD-010 — RY says no; we make it an option
  };
};
```

### 3.2 Algorithm

1. Resolve the query to a member id set. Refuse if empty; refuse above the space's
   requirement limit.
2. If `includeParentDependencies`, transitively add parents to the closure, reporting how
   many were added, and repeat until fixed point or depth 10.
3. Open one transaction. For each member, insert a requirement row with
   `baselineId = this baseline`, `status = ARCHIVED`, copying title, `bodyHtml`,
   `bodySearch`, `anchorPath`, `typeId`, `originVersionId`.
4. Copy inline properties. Copy external properties only if the option is set.
5. Copy dependencies **whose parent and child are both members**. Dependencies pointing
   outside the baseline are recorded in `BaselineDanglingDependency` so the diff can
   explain them, rather than being dropped silently.
6. **Pin the document versions.** Every `originVersionId` referenced by a frozen row is
   marked `pinned = true` and becomes undeletable. This closes research §5.3 leak 3.
7. **Materialise images.** Every image referenced by a member's body is copied into
   content-addressed storage and the frozen body rewritten to the immutable URL. This
   closes research §5.3 leak 2 — the leak RY documents and works around by advising users
   not to use images. See `RD-012`.
8. Set `state = FROZEN`, `frozenAt`, `frozenById`. Commit.

Runs as a job with progress and cancel. RY's docs name baseline creation as the operation
that exhausts the heap (research §6.7), so step 3–5 batch in chunks of 500 and the job
streams rather than loading the whole set.

### 3.3 What is *not* frozen, and is stated in the UI

- Requirements outside the member set continue to change (research §5.3 leak 1). The
  freeze summary states how many dependencies point outside the baseline.
- External properties, unless the option was set.

### 3.4 Refreeze

Add, remove or update members of an existing frozen baseline. Implemented as delete +
re-insert of the affected rows in one transaction, with a `BaselineRevision` audit row
recording who, when, why and the before/after member counts. A refrozen baseline is
visibly marked as revised; the revision history is not erasable.

## 4. Numbering and naming

- `number` is sequential per space, assigned at creation, immutable, never reused
  (invariant B2), including after deletion. It comes from a monotonic per-space counter,
  not from `max(number)` over the baselines that remain — see `RD-046`.
- `name` is free text and renameable; renaming does not affect the number.
- Both are accepted wherever a baseline is referenced: `baseline = 3`,
  `baseline = 'Release 1.3c'`, `isModified('3')`, `isModified('Release 1.3c')`.
- Addressing: `<SPACE>/<KEY>/<number|current>` (research §2.7).

## 5. Diff

### 5.1 Model — query-driven, not baseline-pair-driven

RY's diff takes **two queries**, and selecting two baselines merely pre-fills them
(research §5.5). We keep that, because it makes "diff a subset" free.

```ts
type DiffRequest = {
  left: string;                  // RQL, e.g. "baseline = 3"
  right: string;                 // RQL, e.g. "baseline = 6 and key ~ 'TECH%'"
  compare: {
    title: boolean;              // default true
    body: boolean;               // default true
    inlineProperties: boolean;   // default true
    externalProperties: boolean; // default false
    dependencies: boolean;       // default false
  };
  ignore: {
    formatting: boolean;         // default true
    images: boolean;             // default true
    hyperlinks: boolean;         // default true
  };
  filter: ('added' | 'removed' | 'modified' | 'unchanged')[];
  limit: number;                 // default 600
};
```

### 5.2 Algorithm

1. Resolve both sides to maps keyed by requirement **key** (not id — the whole point is
   comparing across snapshots).
2. `added` = right only. `removed` = left only. Present in both → compare.
3. For each compared field, normalise first per the `ignore` flags:
   - formatting → compare `bodySearch`, not `bodyHtml`;
   - images → replace image nodes with a placeholder token;
   - hyperlinks → compare link text, not href.
4. Classify as `modified` if any enabled field differs, else `unchanged`.
5. Field-level detail: word-level diff for title and body, set diff for properties and
   dependencies.

### 5.3 `isModified(baseline)`

The search-syntax counterpart. Defined as: this requirement's **live** version differs
from its snapshot in that baseline under the **default compare set** (title, body, inline
properties) with the **default ignore set**. RY never states the field set
(research §5.5 gap); we state it, and `09-decision-log.md` records it as `RD-013`.

A requirement not present in the baseline is **not** `isModified` — it is new, and is
found with `NOT (baseline was N)`.

### 5.4 Limits

Default 600 rows like RY, raisable to the space limit for an export. Beyond 2,000 the UI
requires the export path. Diff export is `.xlsx` and runs as a job.

## 6. History

Per-requirement change log, off by default per space (research §2.7), because it is the
largest table in the system.

- Records `changeKind ∈ {CREATED, TITLE, BODY, PROPERTY, DEPENDENCY, KEY_RENAMED,
  TYPE, STATUS, EXTERNAL_PROPERTY, BASELINED}` with JSONB before/after.
- Searchable by actor, by requirement, by record id (`SJ/J-026/current`), and by date.
- **Authorship is correct here.** RY warns that concurrent editing means only one author
  is recorded and a failed job can misattribute a change (research §2.7). Because we own
  the editor, every change carries the editing session's actor, and history rows are
  written in the same transaction as the index update. This is `RD-014`.
- Retention is configurable per space; pruning never removes rows that a frozen baseline
  depends on.

## 7. Compliance posture

The features above exist to answer one question in an audit: *"prove this requirement set
was agreed on this date and has not changed since."* Three things make that answer hold,
and none of them may be weakened without a decision-log entry:

1. Frozen rows are immutable at the database level, not just in application code — a
   `BEFORE UPDATE` trigger rejects any update of a row carrying a baseline.
2. Document versions behind frozen rows are pinned and undeletable — likewise a trigger,
   `BEFORE DELETE` on `DocumentVersion` when `pinned`, so the guarantee does not depend on
   the repository layer being asked politely.
3. Images are materialised, not referenced — fetched behind the SSRF guard of `RD-043`,
   stored by digest, and served through a permission-checked route.

Deleting a baseline deletes its frozen rows and nothing else; it cannot orphan them into
live rows, which would collide with the live rows of the same keys (invariant R1).
