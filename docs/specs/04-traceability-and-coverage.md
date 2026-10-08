# 04 — Traceability, dependency matrix, coverage, reports

## 1. Three distinct screens, often confused

| Screen | Shape | Driven by |
|---|---|---|
| **Traceability matrix** | one row per requirement, configurable columns | **one** RQL query |
| **Dependency matrix** | requirement × requirement grid | one RQL query, used for both axes |
| **Coverage** | counts per relationship and direction | one RQL query |

Requirement Yogi's "traceability matrix" is **not** a two-axis grid (research §4.2). Do
not build it as one. The grid is the *dependency* matrix (research §4.3).

## 2. Traceability matrix

### 2.1 Configuration

```ts
type MatrixConfig = {
  query: string;                 // RQL; drives the rows
  columns: MatrixColumn[];
  pageSize: number;              // default 100, max 600 (research §6.7)
  treeView: boolean;             // group rows by defining document
};

type MatrixColumn =
  | { kind: 'key' }
  | { kind: 'title' }
  | { kind: 'document' }
  | { kind: 'status' }
  | { kind: 'property';  name: string }
  | { kind: 'external';  name: string; editable: boolean; aggregate?: Aggregate }
  | { kind: 'dependency'; direction: 'to' | 'from'; relationship?: string; depth: 1|2|3|4;
      render: 'key' | 'key+title' | 'count' }
  | { kind: 'ruleStatus'; typeId?: string }
  | { kind: 'computed'; expression: string };   // RD-004, see below
```

`Aggregate ∈ {sum, min, max, avg, count}` — RY's documented set (research §2.6),
recomputed live as values are edited.

**Cell rendering** uses the shared badge vocabulary in `10-ui-reference.md` §7: a
dependency cell shows chevroned key lozenges, comma-separated when there are several
(`› FN-09, › FN-06`), each carrying its direction arrow and opening the shared popup on
hover. Do not invent a second visual language for links inside matrices.

### 2.2 Editing in place

The toggle at the start of the toolbar line switches to edit mode — green when on
(`10` §20, videos-2 §4.2). In edit mode, `external` columns become inputs whose control
follows the property type (`01` ExternalPropertyDefinition): a number field for `FLOAT`
and `INTEGER`, a checkbox for `BOOLEAN`, a select for `DROPDOWN`, text otherwise. Each
cell saves on blur. The column cog offers **set value in bulk** across the whole result
set, not just the visible page. Inline properties are **not** editable here — they
belong to the page (overview, decision 2).

**Adding a column.** `+ Add property` in the first column header opens *Add external
property column*: search existing definitions, or *Or create a new one* with a name and
a `Type`. Creating one needs the space-admin permission (`07` §2.4); the column is added
to this matrix at once. There is no limit on the number of definitions.

**Row tree.** Rows with dependencies carry a `›` expander that opens the dependency tree
beneath the row, one level per click, to the depth cap (`02` §5.1).

**Timing.** The toolbar shows *Built in {ms} ms.* for every render — users judge whether
to narrow a query from that number.

### 2.3 Saving and embedding

Saved matrices get a name and a visibility (`private` | `space` | `public-link`).
A saved matrix is embeddable in a document via a `savedMatrix` block node referencing its
id, and renders live data at view time.

`$currentBaseline` in a saved matrix's query resolves to the baseline of the document
the matrix is embedded in, so one saved matrix works inside every baseline report
document (research §3.6).

### 2.4 Computed columns — `RD-004`

RY explicitly cannot do this: "it cannot be used to display % coverage" (research §4.2).
We add a `computed` column kind evaluating a small expression language over the row:

```
count(from@satisfies)
percent(count(from@verifies) > 0)
first(@Priority)
```

Deliberately tiny: aggregate functions over dependency sets and properties, comparison,
`percent()`. No arbitrary expressions, no cross-row references. Scheduled for a slice
after the matrix (slice 8) ships without it.

### 2.5 Performance

- Row query and column data are fetched in **two phases**: page of requirement ids
  first, then a batched fetch per column kind for exactly those ids. Never N+1.
- Transitive dependency columns use one recursive CTE per column with a visited-set
  guard and the depth cap from `02-query-language.md` §5.1.
- Export to `.xlsx` runs as a job, not a request.

## 3. Dependency matrix

- Both axes are the result set of the query, ordered by key.
- Cell contents: the set of relationship names linking row → column, rendered as
  initials with a tooltip; empty when none. Direction is row-as-child → column-as-parent
  (invariant P1).
- **Web view cap: 40,000 cells (200 × 200)** — RY's documented limit (research §4.3).
  Over the cap, the UI refuses and offers the export instead.
- **Export**: `.xlsx`, two sheets (matrix, legend + requirement list), frozen panes,
  hyperlinks back into the app. Runs as a job; no cap beyond memory.
- Refuse to run on an empty query, as RY's own guidance advises.

## 4. Coverage

### 4.1 Definition

For a query result set `P` (the population) and each relationship `r` and direction
`d ∈ {to, from}`:

```
covered(r, d)   = { q ∈ P : ∃ dependency of relationship r, direction d, from q }
uncovered(r, d) = P \ covered(r, d)
coverage(r, d)  = |covered(r, d)| / |P|
```

RY reports only counts (research §4.4). **We report both count and percentage**
(`RD-004`). Every figure is clickable and lists the underlying requirements; the
uncovered set is directly listable, which is the feature users actually want.

### 4.2 Presentation

One row per (relationship, direction) discovered in the population, plus a synthetic
"any dependency" row. Columns: population, covered, uncovered, coverage %.

A target coverage threshold per relationship can be set per space; below it the row is
flagged. This drives the compliance story and has no RY equivalent.

### 4.3 Guard rails

Coverage and the dependency matrix are gated on the `EXPORT` permission
(`07-permissions-and-limits.md`) and refuse an empty query — both straight from RY's
documented guidance (research §4.3).

## 4a. The Reports tab

The newer RY build has a **Reports** tab (videos-2 §1) that the videos never open. Ours
lists every saved traceability matrix, dependency matrix and report definition in the
space — name, kind, owner, visibility, last viewed — with open, rename, duplicate and
delete. It is also where the sidebar's `View all` lands (`10` §9.5).

## 5. Reports

A `report` block node embeddable in documents, equivalent to RY's RY Report macro
(research §4.5).

```ts
type ReportConfig = {
  query: string;
  columns: string;            // "key, description+properties, links"
  countOnly: boolean;
  useLastRequirement: boolean;
  useLastRequirementDefinition: boolean;
};
```

**Columns mini-syntax** — kept compatible with RY so existing muscle memory works:

- `,` separates columns, `+` concatenates fields within a column.
- Fields: `key`, `description`, `properties`, `status`, `original`, `links`, `to`, `from`.
  (`jira` and `tests` are not implemented.)
- Options: `<field>[@<relationship>][?opt=val&…]` with `format ∈ {short, page}`,
  `li ∈ {true, false, last}`, `duplicates=false`.
- Default: `key, description+properties, links`.

**"Last requirement" semantics** (research §4.5): ticking either checkbox ignores the
query and resolves against the nearest preceding requirement link or definition in the
document. `useLastRequirementDefinition` overrides the other and renders the *previous*
definition's description to avoid recursion.

**Recursion guard.** A report inside a requirement's scope must not be indexed as part of
that requirement's text. The indexer skips `report` and `savedMatrix` nodes entirely when
computing `bodySearch` — cleaner than RY's requirement that users hand-place a property
macro to avoid recursion.

**Performance warning.** More than 5 report nodes in one document shows an editor
warning; RY's docs name this as a common cause of slow pages.
