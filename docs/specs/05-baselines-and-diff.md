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

**Instant baseline** — creation and freeze in one action, scoped to a single page (and
optionally its descendants), with no report page. RY's fourth creation path (research
§5.1).

### 2.1 Three ways to create, as the screencast teaches them

The vendor's baseline video is organised around exactly three entry points (videos-2
§2.2). The GUI is `10` §14–15; the behaviour behind each:

| Entry | Scope | Wizard | Default name |
|---|---|---|---|
| **Baselines tab → Create a new baseline** | all requirements in the space, or an optional query | full wizard | `Baseline {n}` |
| **Search → select → Actions → Make Baseline** | user picks: the selected requirements · the searched requirements · all requirements in the space | full wizard, with the Scope block | `Baseline {n}` |
| **Page byline → Create baseline from this page (/ and its descendents)** | the page's definitions, plus descendants if chosen | none — instant | `Baseline {n} for {page title}` |

The scope a wizard receives is stored as the baseline's `sourceQuery`, so a refreeze can
re-run it. *Reuse the selected requirements* stores `key IN (…)`; *Reuse the searched
requirements* stores the user's query verbatim.

### 2.2 Wizard options and their defaults

| Option | Values | Default |
|---|---|---|
| When | Freeze requirements now · Freeze requirements later | **now** |
| Baseline page | None (simple) · Create a baseline and an associated page | **None (simple)** |
| Dependencies | include parent requirements outside the scope | **off** |

*Freeze later* creates a `DRAFT` (§2); *now* creates and freezes in one job. *Create … an
associated page* creates a report page carrying a baseline block, the requirement list,
and a Freeze button while in draft.

### 2.3 Status display

The Baselines tab shows `DONE` for `FROZEN` — the only status in the videos — and `DRAFT`
for `DRAFT`. A baseline whose freeze job is running shows the job's progress in its row.

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

### 3.3a Deletion

Deleting a baseline needs the **baseline-deletion permission**: space administrators by
default, plus members of the groups configured in Administration → Options who can also
edit the space (`07` §2.4, videos-2 §4.6). Deletion removes the frozen rows and unpins
their page versions, but the number is never reused (B2) and an audit row records it.

### 3.4 Refreeze

Add, remove or update members of an existing frozen baseline. Implemented as delete +
re-insert of the affected rows in one transaction, with a `BaselineRevision` audit row
recording who, when, why and the before/after member counts. A refrozen baseline is
visibly marked as revised; the revision history is not erasable.

## 4. Numbering and naming

- `number` is sequential per space, assigned at creation, immutable, never reused
  (invariant B2), including after deletion.
- `name` is free text and renameable; renaming does not affect the number.
- Both are accepted wherever a baseline is referenced: `baseline = 3`,
  `baseline = 'Release 1.3c'`, `isModified('3')`, `isModified('Release 1.3c')`.
- Addressing: `<SPACE>/<KEY>/<number|current>` (research §2.7).
- **A baselined requirement displays as `KEY vN`** — `BR-01 v1` — in search, matrices,
  diff, links and the popup header (videos-2 §2.4). *"Baselined requirements take the
  number of the baseline in the key, and in the URL"*: the URL is
  `/requirements/{SPACE}/{KEY}/{N}` (`RD-044`).
- A baseline's own short identifier, used in pickers and integrations, is `{SPACE}-{N}` —
  `TEAM-1` — as the video's Jira dialog shows.
- **Baselined versions are read-only everywhere.** Search shows them on a grey
  background; edit actions are disabled with *"You can only edit requirements in the
  Current version."*

### 4.1 Page history marker

Freezing writes a marker against every page version it pins: page history (`10` §23)
shows the comment `Baseline "<name>" for Reqforge` on that version, and its Delete action
is disabled. RY achieves the same by creating a new page version with that comment
(videos-2 §2.8); we annotate the existing version instead, because creating a version
would make the pinned content and the marked version differ by one (`RD-041`).

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

### 5.1a How the Diff tab maps onto the request

| GUI (`10` §16) | `DiffRequest` |
|---|---|
| First query / Second query | `left` / `right`; an empty second query means current requirements, labelled `Set 2` |
| `Compare ▾` → Description | `body` + `title` |
| `Compare ▾` → External properties | `externalProperties` |
| `Compare ▾` → Dependencies | `dependencies` |
| `Compare ▾` → Issues | phase 3 |
| `Display ▾` | `filter` |
| `Limit (600) ▾` | `limit` |
| `Display descriptions` | render-only; detail is computed either way |

Inline properties are always compared: the video's diff shows them changing with no
option to hide them.

Row classification renders as state badges — `MODIFIED`, `REMOVED`, `ADDED` — with
`NON EXISTING` in the column where the requirement is absent. In the detail view,
**removed text is red with strikethrough and added content is highlighted green**.

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

### 6.1 What baselines are not

The vendor's own tips (videos-2 §2.9), adopted as product statements:

- *"We do not have branches: you cannot have two diverging versions of your docs."*
  Baselines are snapshots of one line of history, not branches (`RD-009`).
- *"We do not track every little change on requirements."* Page history is the record of
  who changed what; requirement history (above) is the opt-in finer grain.

## 7. Compliance posture

The features above exist to answer one question in an audit: *"prove this requirement set
was agreed on this date and has not changed since."* Three things make that answer hold,
and none of them may be weakened without a decision-log entry:

1. Frozen rows are immutable at the database level, not just in application code.
2. Document versions behind frozen rows are pinned and undeletable.
3. Images are materialised, not referenced.
