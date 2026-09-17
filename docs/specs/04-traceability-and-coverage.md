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

### 2.2 Editing in place

A toggle at the top switches to edit mode. In edit mode, `external` columns marked
`editable` become inputs, and the column cog offers **set value in bulk** across the
whole result set, not just the visible page. Inline properties are **not** editable here
— they belong to the document (overview, decision 2).

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
`percent()`. No arbitrary expressions, no cross-row references. Scheduled for slice 6,
after the matrix ships without it.

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
