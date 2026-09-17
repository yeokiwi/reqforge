# Requirement Yogi — Data Center: distilled documentation notes

Source: <https://docs.requirementyogi.com/data-center> and its subpages, read 2026-09-17.

This file records **what the vendor documentation actually states**. It is the evidence
base for `docs/specs/`. Everything here is sourced; everything the docs do *not* answer
is listed under **Gaps** at the end of each section and must be resolved by a decision
in `docs/specs/09-decision-log.md` rather than by assumption.

---

## 1. Product shape

Requirement Yogi (RY) is a Confluence app. Requirements are authored **inside ordinary
Confluence pages** by wrapping a key in an RY macro (`Alt+Shift+R`). RY indexes those
pages, gives every requirement a unique key and URL, and layers search, traceability,
baselines and export on top. Companion apps exist for Jira (`Requirement Yogi for Jira`)
and testing (`RY Testing and Compliance`).

The positioning is explicitly anti-Word: large specifications get split across pages,
and requirement insertion and navigation take seconds rather than manual Ctrl+F and
hand-built hyperlinks.

---

## 2. The requirement

### 2.1 What one is

- The unit of capture is **the whole line or table row** containing the macro. On save,
  the macro turns that line into a requirement.
- A requirement carries: **key**, **title/description**, **properties**,
  **dependencies**, optional **external properties**, and a **baseline context**.
- In a table layout, **every column becomes a property**. One column is ticked as
  "Title" via the RY Property macro and supplies the description.
- Layouts supported: horizontal tables, vertical tables, paragraphs.
- Authoring guidance (advisory, not enforced): short titles, one requirement per row,
  detail in other columns; do not model a whole section as one requirement.

### 2.2 Keys

- **Allowed characters, verbatim**: "Only letters, numbers, underscore (\_), hyphen (-)
  and dot (.) are accepted." No slashes. No spaces.
- Recommended shape is prefix + number: `FUNCTIONAL-001`, `FN-001`, `BR-01`, `TECH-001`.
- **Uniqueness is per space** by default. A "Generate global keys" setting makes them
  unique per installation.
- Key numbers cap at 2^63−1.
- **Enforcement is advisory on the client only.** The docs warn a user can bypass key
  rules via browser devtools, and that duplicates created by copy-paste or REST surface
  in bright red for manual resolution. Server-side revalidation is required.
- Avoid single-word keys; RY is not intended as a glossary.

### 2.3 Key suggestions (auto-numbering)

- Each new key registers its **pattern** in the space's suggestion list.
- The last written number is retained even after deletion, so the next suggestion
  continues past deleted numbers. A back-arrow action resets the counter to the last
  existing requirement; the "Prevent using deleted keys" setting governs that.
- "Lock keys" restricts users to configured patterns. "Links across spaces" controls
  whether other spaces' requirements appear in the insert picker.
- Settings exist globally and per space, with per-space override.
- **Promotion rule, verbatim**: "The only difference between a simple 'key suggestion'
  and a requirement type is having a name." (Merged into Requirement Types in RY 4.0.)

### 2.4 Requirement types (RY 4.0+)

Three stated purposes: key patterns (including locking), **validations** (required
properties and dependencies), and **templates**.

- Type properties are authored as a horizontal table in the config screen, mirroring the
  resulting page layout.
- Property criticality is colour-coded: **required → red**, shown in view *and* edit
  mode; **optional → yellow**, edit mode only. View mode flags only required-property
  failures.
- **Templating**: inserting a key of a type into an *empty* table scaffolds the type's
  required + optional columns. Columns are not inserted once the table has text.
- **Quick fixes** appear next to red messages and add the missing columns.
- **Validation triggers, exhaustively**: (a) page reindex runs all validations;
  (b) clicking "Play" on one type runs that one validation and needs EDIT on the space.
  It is *not* possible to rerun all validations across a space.
- A badly formatted table (e.g. a grey first row that is not a real header row) is
  reported as a **warning**, distinct from a required-property error.
- **Hard limits, verbatim**: per validation run — 200 SQL requests, 1000 messages,
  5 seconds; maximum 20 requirement types applying to a single page.
- Permissions: view space → read types; edit space → run one type's validations, reset
  sequences; space admin → create/update/delete types, lock keys.

### 2.5 Properties

- **Inline properties** are the requirement's table columns. Indexed and searchable.
- The **RY Properties macro**, placed in a column header, can: define a property name and
  value, rename the column for property purposes, ignore the column, or tick **Title**
  to mark the description column.
- **Constraint, verbatim**: "Searchable columns can't contain a space."
- A property becomes a clickable query link in the popup only if its name is short
  ("<80 letters") and has no space. The generated query form is `@Property = 'CRITICAL'`.

### 2.6 External properties / estimates (RY 3.0+)

- Stored **outside** the document; editable without touching the author's page. Rendered
  in the requirement popup marked with an asterisk `*`.
- **Definitions are global to the instance**, administered centrally; values are per
  requirement. Creating a new external property requires space admin; editing values
  requires edit permission on the space; everyone in the space can see them.
- Admin operations: change data type, search by that property, delete unused ones.
- Data types referenced: numeric/cost, checkbox, comments/text, tags. No exhaustive list.
- Editing surfaces: the traceability matrix (cog menu adds the column, a toggle at the
  top enters edit mode), bulk set from the column cog menu, and the Excel Loop.
- **Aggregations per column**: sum, min, max, average, count — recomputed live.
- "Estimates" is not a separate entity; it is the original use case, and the tab was
  renamed "External Properties".
- External properties are **not baselined**.

### 2.7 History (RY 4.4+)

- Stores changes to requirement details only. **Off by default**; an admin enables it.
- Visible to space admins, global admins, and "owners of objects when relevant".
- Searchable by user or by record ID. Record ID forms, verbatim: `J-026`,
  `SJ/J-026/current`, `SJ/J-026/1` → the grammar is `<SPACE>/<KEY>/<baseline|current>`.
- **Authorship caveat**: with concurrent editing only one author is recorded per change,
  and a failed job can attribute a change to whoever next reindexed the page.

### 2.8 Renaming (RY 1.7+)

- Select on the search screen: individual rows, or the box next to "Key" to select every
  requirement matching the current query, including beyond the display limit.
- **Batch rename decomposes each key into prefix + middle + suffix.** Prefix/suffix are
  the pattern common to all selected keys. The user edits only the first line; the rest
  update live with the same transformation.
- Rename propagates to: every occurrence in documents, dependencies, and Jira issues.
- Runs as an async task with progress, live status, "Stop and cancel", and an
  "Acknowledge" exit. **On error: "No modification was saved"** — full rollback.
- "Ignore JIRA errors" downgrades Jira errors to warnings; the consequence is stale Jira
  links that must be removed and re-added manually.
- Permission: global admin, or a group granted "Requirement rename" in configuration.
- **Limitation**: rename rewrites page XHTML, so requirements not stored in a Confluence
  `ContentEntityObject` (e.g. Scaffolding live templates) are missed.

### Gaps (section 2)

- No field-level schema: no documented `excerpt` or `anchor` field names or anchoring
  mechanics beyond "requirements have a unique hyperlink".
- No rule DSL or expression syntax for requirement type validations. The docs describe
  only required/optional properties and dependencies — not a general rule language.
- Vertical-table and paragraph layout mechanics are described only in outline.

---

## 3. Search syntax

The Data Center page is titled **"Search Syntax"**; the term "RYQL" appears on the Cloud
side only. **Neither page is a formal grammar**: there is no stated operator precedence,
no associativity, no tokenizer rules, no EBNF.

### 3.1 Default scope

- Only **active requirements of the current space**. A "Cross space" tick box and a
  "show all baselines" filter change that.
- `status` defaults to `ACTIVE`; the docs call it an internal detail and warn against
  confusing it with a user property named `@status`.
- Specifying `baseline = …` implicitly includes all statuses.

### 3.2 Fields (Data Center)

| Field | Value | Notes |
|---|---|---|
| `key` | string | Case-insensitive when used with `~` |
| `key_case_sensitive` | string | 4.6.1, for use with LIKE |
| `spaceKey` | string | Case sensitive |
| `baseline` | name or number, or `$currentBaseline` | All statuses implicitly included |
| `baseline was` | name or number | 3.2.0 — matches a *previous* version's baseline |
| `status` | `ACTIVE`\|`DELETED`\|`MOVED` | Internal |
| `text` | string | Contents; **excludes properties** |
| `page` | page id | Since 3.1 exactly that page; excludes dependencies |
| `pageHistory` | page id | 3.1; all versions of that page; `~` undefined |
| `links` | page id | 3.1; pages where linked or defined; `~` undefined |
| `jira`, `jira@<rel>` | issue key | `@rel` since 1.5 |
| `@<property>` | string/number | User property |
| `ext@<property>` | typed | External property |
| `to@<rel>` / `from@<rel>` | requirement key | Dependency by relationship |
| `TO`/`PARENT`, `FROM`/`CHILD` | requirement key | Bare dependency, any relationship |
| `excel` | attachment id | 2.0 |
| `ruleStatus`, `ruleStatus@<typeId>` | `'true'`\|`'false'`\|`'warning'` | 4.6.2; `@162` is a numeric type id |

Cloud additionally has: `link`, `project`, `projectName`, `variant`, `parent`/`child`
aliases, `@Level`, `@Section`, page search by title with `?`/`*` CQL wildcards, and
`ruleStatus@<rule name>` (name, not id).

### 3.3 Operators

| Operator | DC | Cloud | Semantics |
|---|---|---|---|
| `=`, `==` | yes | yes | Strict equality |
| `!=` | — | yes | Not equal |
| `~` | yes | yes | Soft equality, `%` wildcard |
| `LIKE` / `NOT LIKE` | — | yes | Synonyms of `~` / negation |
| `<`, `<=`, `>`, `>=` | 4.6.0 | yes | Text compares **alphabetically in ASCII order**, which makes ISO-date comparison work |
| `IN (...)` | 4.6.0 | yes | Numbers may be unquoted |
| `NOT IN (...)` | — | yes | |
| `IS NULL` | yes, any attribute | yes | |
| `IS NOT NULL` | yes, **documented for `baseline` only** | yes, general | Real DC/Cloud divergence |
| `AND`, `OR`, `NOT`, `( )` | yes | yes | Precedence **not stated** |
| `@` | yes | yes | Property reference |
| `->` / `→` | — | yes | Traversal into a linked requirement; existential |

`->` takes a parenthesised boolean expression as its right operand, e.g.
`from@relation1->(text ~ '% something' AND from@relation2->@Delivered = 'true')`.
So it is a scoping/navigation operator, not a plain binary comparison.

### 3.4 Escaping and quoting

- A **backslash escapes the next character** inside an unquoted property/qualifier name:
  `@Main\ Category`, `parent@Test\ Result`, `ruleStatus@my\ rule`. There is **no
  documented quoted form** for property names.
- String values use single quotes. Numbers may be unquoted. The empty string `''` is a
  legal literal. Booleans are quoted on DC (`ruleStatus = 'false'`) and bare on Cloud.
- **No documented escape mechanism inside a quoted string.**

### 3.5 Functions (Data Center only — Cloud documents none)

| Function | Signature | Semantics |
|---|---|---|
| `isModified` | `isModified('7')` | Changed since that baseline of the current space; accepts number or name |
| `hasTest` | `hasTest( [relationship,] expectedResult [,page])` | Requires the Testing add-on |
| `hasLastTest` | `hasLastTest( [relationship,] expectedResult [,page])` | Example `hasLastTest('%Success%')`; matched with `%` wildcards despite the docs saying "equal" |
| `user` | `user('admin')` | A **value**, not a predicate: `@property = user('admin')`. Matches a mention of the username or the stable user key |

Parser consequence: `user()` sits in value position; the other three occupy a whole
predicate position. Two grammar productions are needed.

### 3.6 Special variables

`$currentBaseline` (DC, since 2.6.3), used as the value of `baseline`, so a saved
traceability matrix can be reused inside baseline templates.

### 3.7 Storage-format subtleties (DC, since 2.4)

RY stores a rendered HTML form and a separate **searchable** form. Consequences:

- `@property = '(/)'` matches the check-mark emoticon by its wiki shortcode.
- `@property = 'item1'` matches a property whose **list** contains `item1`. For
  list-valued properties `=` is **set membership**, not whole-value equality.

### 3.8 Example queries (verbatim, Data Center)

```
key = 'IG-1'
key ~ 'IG-%'
key_case_sensitive ~ 'REQ_Work_%'
key ~ 'REQ-%' and not key_case_sensitive ~ 'REQ-%'
text ~ '% something'
page = 467382
pageHistory ~ 123
jira = 'JRA-21'
jira@implements = 'JRA-21'
NOT (jira ~ '%')
JIRA IS NULL
@Category = 'Functional'
@status = 'Approved'
@Status IN ('New', 'In progress')
@Main\ Category = 'Functional'
@ReleaseDate > '2026-06-30'
@Property > 5
ext@Category = 'Functional'
TO = 'REQ-001'
FROM = 'REQ-001'
FROM ~ 'REQ-%'
FROM@refines = 'REQ-001'
isModified('7')
baseline = 3
baseline was 3
baseline = 4 and baseline was 3
baseline = 'My Baseline'
ruleStatus = 'false'
hasLastTest('%Success%')
excel = '48496653'
key ~ 'FN%' AND NOT (@Property = 'Functional' AND @Component = 'Core')
```

### Gaps (section 3)

Operator precedence and associativity; keyword case sensitivity; escaping inside quoted
strings; how to match a literal `%`; whether `~` applies to numeric fields; `>`/`<`
behaviour on mixed text/number properties; `hasTest` argument disambiguation; whether
`isModified` accepts more than one argument; three-valued NULL logic under `NOT`.

---

## 4. Dependencies, traceability, coverage

### 4.1 Dependency model

- **There is no textual link syntax.** A dependency is a requirement-link macro placed
  inside a requirement's definition (same insert flow, choosing an existing requirement),
  rendered as an arrow before the key.
- Link macro configuration: **Property** (which property of the target to display, live)
  and **Version** (pin the link to a baseline of the target).
- **Relationship name source**: in tables, the **column header** of the column holding
  the link. In paragraphs, the default relationship is `Dependency`. Relationships are
  therefore free-form and user-defined — there is no admin-configured relationship enum.
- **Direction rule, load-bearing**: the link inside a requirement's definition is always
  the `PARENT`, i.e. the `TO` side. If `FN-01` references `BR-01`, then `BR-01` is a
  *parent of* `FN-01`.
- Paragraph layout: the link must sit in the same paragraph as the definition to be
  indexed as a dependency.
- **Broken links** (pointing at deleted requirements) are listed in a dedicated screen.
  Dangling references must survive; do not cascade-delete.

### 4.2 Traceability matrix — it is NOT a two-axis grid

This is the most commonly misread mechanic:

- Rows = the result set of **one search query**. Recommended to narrow it,
  e.g. `key ~ 'REQ-%'`.
- Columns = added from a **cog menu**: a requirement property, a dependency selector, or
  a Jira field. Dependency columns can be per-relationship, per-direction, and can show
  **multiple levels** (transitive depth).
- A tree view on the left allows drill-down.
- **Saving**: a Save button asks for a name and permissions; saved matrices appear in a
  Reports tab. They can be embedded into a page via "Insert as a macro" or by pasting the
  URL, and render live data.
- **Documented limitations**: no calculations — it explicitly *cannot* display %
  coverage; no filters beyond the driving query; not every Jira field.
- Jira data is cached **5 days**; a checkbox next to "Get data from Jira" empties it.
- Pagination is comfortable at **600 rows per page** over tens of thousands of results.

### 4.3 Dependency matrix — this one *is* a grid

- A genuine requirement × requirement grid. Web view capped at **40,000 cells
  (200 × 200)**; Excel export unlimited, tested at **5000 × 5000**.
- Excel export is native `.xlsx`, **2 sheets, frozen panes, hyperlinks**.
- The Coverage and Dependencies tabs are visible only to users with the **Export Space**
  permission, because the memory cost is HTML generation. Advice: never run them with an
  empty query.

### 4.4 Coverage

Defined **only by example, in counts** — no formula and no percentage appears in text:

- "The functional requirements is a parent of **6 of your 23** requirements."
- "**11 of all the requirements** are refined by another requirement."
- Each figure is clickable and lists the underlying items.
- Requirements **missing a link** can be listed so coverage can be completed.

Safe reading: the denominator is the query result set; coverage is computed **per
relationship and per direction**; covered = has at least one dependency of that
relationship/direction. Multiple relationships are reported side by side.

### 4.5 RY Report macro

Parameters: **Query**, **Columns**, **Count** (render only the count), **Use the last
requirement**, **Use the last requirement definition**.

Columns syntax: comma separates columns, `+` concatenates fields within one column.
Default layout is `key, description+properties, links+jira`.

Fields: `key`, `description` (2.5.3), `properties`, `jira`, `status`, `original`
(2.5.3), `links`, `to`, `from`, `tests`.

Field options, query-string style `<field>[@<rel>][?<opt>=<val>&…]`:
`format` ∈ {`short`, `page`}, `li` ∈ {`true`, `false`, `last`}, `duplicates=false`.

"Last requirement" semantics: ticking either checkbox **ignores the search query** and
resolves against the nearest preceding requirement link or definition; "use the last
requirement definition" overrides the other and renders the *previous* description to
avoid infinite recursion.

### Gaps (section 4)

Dependency-matrix cell glyph and content; whether the Coverage tab shows a percentage;
traceability-matrix column-config field names (screenshot only); relationship-name
normalisation (case, whitespace); transitive depth limit; cycle handling.

---

## 5. Baselines, versioning, diff

### 5.1 Creation paths (exactly four)

| Path | Flow | Page created | Frozen |
|---|---|---|---|
| From a search | tick requirements → Actions → "Make a baseline" | yes | on explicit Freeze |
| From the baseline screen | Requirements → Baselines → "Create new baseline" | yes | on explicit Freeze |
| From the Create button | blueprint "Baseline page" | yes | on explicit Freeze |
| **Instant** | byline icon, current page only | **no** | immediately |

A baseline is therefore a **two-phase object**: draft (page exists, nothing frozen) then
frozen. The docs are emphatic that creating the page is not enough.

### 5.2 Capture options (wizard)

Which requirements (selection / full search result / whole space); freeze now or later;
associate a report page (freeze button, impacted pages, full requirement list); update
Jira link versions; and — if selected requirements have **parent** dependencies — offer
to freeze the dependencies too.

### 5.3 What is frozen, and the leaks

- Text and properties are frozen and "can't be modified".
- **Leak 1** — related requirements *not* in the baseline still change. A baseline is not
  a transitive closure unless you opt into the dependencies option.
- **Leak 2** — images are **not copied**; only the URL is stored. Swapping the image
  behind the URL changes what the baseline renders. Docs advise against images.
- **Leak 3** — page history can be altered by admins and plugins; click-through may land
  on the *closest* version, not the exact one.
- External properties are not baselined.
- Baselines **can** be deleted (space admin). Renaming a baseline renames its page.
- **Refreeze** is the documented mutation escape hatch: reuse a baseline and add, remove
  or update requirements.

### 5.4 Numbering and identity

- "The number of a baseline is sequential, autonumbered and fixed."
- Addressable by number or name: `isModified('1')` and `isModified("Release 1.3c")`.
- Canonical addressing triple confirmed by the History record IDs:
  **space / key / baseline**, with `current` as the sentinel for the live version — which
  in the database is a **NULL baseline**.

### 5.5 Diff

Two UIs: an on-page **Compare** against one baseline, and a **Diff tool** from the
Baselines tab over exactly two selected baselines.

**Diff is query-driven, not baseline-pair-driven.** Selecting two baselines merely
pre-fills two query boxes, e.g. `baseline = 6 and key ~ 'TECH%'`. Model it as
`diff(queryA, queryB, options)`.

| Option | Behaviour |
|---|---|
| Version scope | Compares current versions by default; optionally whole history |
| Line filter | **added**, **removed**, **modified** — the three row classes |
| Limit | 600 rows by default, raisable to the global limit |
| Description box | Must be ticked for full content and inline highlighting |

Comparison scope — this defines "modified": **Description and Properties by default**;
External properties and dependencies opt-in; formatting-only changes, images and
hyperlinks ignorable.

`isModified()` is the search-syntax counterpart, a predicate over current vs baseline
snapshot. The docs never state which fields it examines.

### 5.6 Blueprints

Four templates ship. Guidance only — "not required for the normal behavior".

- **PRD / Requirement Document** — grey icons mark extracted columns; "Description" is
  the only text extracted; "Related Requirements" maps to the `related` property.
- **Baseline** — the **"RY Baseline" macro is the only mandatory element**. The baseline
  page is identified by the presence of that macro, not by the template.
- **Dictionary** — RY inserts requirements into the **last** table only.
- **RY Test Session** — barely customisable by design.

### 5.7 Database schema (the best guide to a faithful data model)

Confluence tables are prefixed `AO_32F7CE`, Jira `AO_42D05A`.

**Identity model**: the logical key is **SPACEKEY + KEY + BASELINE**, alongside a
technical Long `ID`. `BASELINE` is non-null only for ARCHIVED (frozen) rows and **null
for ACTIVE** rows. Baselining is implemented as **row duplication in the same table with
the baseline discriminator set** — not a separate snapshot table.

| Table | Purpose | Documented columns |
|---|---|---|
| `DBREQUIREMENT` | Requirements, current and baselined | `ID`; `SPACEKEY`*; `KEY`*; `BASELINE`*; `STATUS` ∈ {ACTIVE, ARCHIVED, MOVED, DELETED}; `STORAGETYPE`; `HTMLEXCERPT` (the description); `NEWKEY`, `NEWSPACEKEY` (when MOVED); `UPPERKEY` (denormalised for case-insensitive search) |
| `DBPROPERTY` | Properties | `TYPE` ∈ {INLINE, EXTERNAL} |
| `DBDEPENDENCY` | Requirement→requirement | PK: `RELATIONSHIP`, `PARENT_ID`, `CHILD_ID` |
| `DBLINK` | Requirement ↔ page/issue | `PARENT_ID`; `ORIGIN` boolean — true = defining page, false = citing page/issue |
| `DBTRACEABILITYMATRIX` | Saved matrices | PK: `SPACEKEY`, `ORIGINALID` |
| `DBQUEUE` | Async jobs and Jira messages | |
| `DBBACKUPITEM` / `DBBACKUPMAPPING` | Cross-instance export | |
| `DBAPPLINK` | Registered Jira apps | |

\* part of the logical primary key.

Generic metadata columns: `SCHEMAVERSION`, `CREATEDUSER`, `LASTUPDATEDUSER`,
`CREATEDDATE`, `LASTUPDATEDDATE`.

**Notable absence: there is no baseline table documented.** Baseline metadata is
presumably the Confluence page plus the discriminator. A standalone clone must invent
one.

### Gaps (section 5)

Which fields exactly a baseline captures; the relationship between a baseline and the
document version it was taken from; the diff algorithm; refreeze semantics; the fields
`isModified` examines; `$currentBaseline` is not mentioned on any baseline page.

---

## 6. Import, export, API, limits

### 6.1 Word import — there is no importer

Verbatim: "Requirement Yogi doesn't have an 'Import wizard' from Word." The flow is
copy-paste into a page, then **manual annotation in view mode**: highlight a key → inline
popup → "Define as a requirement" or `Alt+Shift+R`.

- Select **only the key** — one run of letters and digits, no spaces. If you transform a
  key, "the whole line will be used as the title of the requirement".
- **Duplicate keys**: the **first** occurrence on the page becomes the requirement; the
  rest become links, even if the user selected the second one.
- Bulk options in the dialog: transform the selection, transform any key with the same
  prefix on this page, or transform by **regular expression**.

### 6.2 Excel Import (legacy) — external requirements, read-only

- Requirements live in a file **attached to a page**; they are not editable in the app.
  Remove the file → its requirements are removed. Re-upload to refresh.
- **Schema drift aborts the import** ("if the columns changed, we skip this importation")
  — it is not a partial merge.
- Imports key, description and properties. Excel rows **cannot declare dependencies**.
- Column mapping roles: `Key`, `Description`, a property, or not imported. **No reserved
  header names exist** — mapping is explicit per column.
- Enrolment is by attachment label `ry-Excel-import`; removing the label marks its
  requirements deleted.
- Addressed in queries as `Excel = '<attachmentId>'`.
- Gated on the space **EXPORT** permission; killable with
  `-Dplaysql.disable.Excel.import=true`.

### 6.3 Excel Loop — round-trip of external properties only

Narrower than the name suggests: it **re-imports external properties onto requirements
that already exist**. It does not create requirements.

- The target external properties must already exist before upload.
- Column mapping cog menu has exactly five roles: `Key`, `Space`, `Baseline`,
  `Import as an external property`, `Ignored`.
- The match key is the tuple **Key + Space + Baseline**. Everything unmapped is ignored;
  requirement text and inline properties are never updated by the loop.
- Templates are reusable and carry their own permissions.
- Conflict handling is documented only as "watch for errors" — no merge semantics.

### 6.4 Excel export

**Not specified in the documentation.** Only mentioned in passing: export from the
traceability matrix, and the dependency matrix's `.xlsx` (2 sheets, frozen panes,
hyperlinks). No column list, no format description.

### 6.5 REST API

Base path `/rest/reqs/1`. Explicitly experimental; unannotated endpoints are `@Internal`.
An OpenAPI v3 document is served per-instance at `/rest/reqs/1/openapi`.

Confluence side, requirements:
`GET /requirement2/{spaceKey}` — search, params `q` (RY syntax), `spaceKey`, `offset`,
`limit`, `order` (default `REQKEY ASC, BASELINE DESC`), `includeArchived`, `expand`.
`GET /requirement2/{spaceKey}/{key}` — one, with `v` = baseline number and
`expand=references`. POST/PUT/DELETE are documented as "Do not use."

Baselines:
`GET /baseline/{spaceKey}` (`expand=details`);
`POST /baseline/{spaceKey}/1/create` with `{name, ceo (page id), queryString}`;
`POST /baseline/{spaceKey}/1/create-instant` with `{name, fromCeo, fromCeoWithChildren}`;
`DELETE /baseline/{spaceKey}/{baseline}`;
`PUT /baseline/{spaceKey}/{baseline}/label` (text/plain);
`GET /baseline/{spaceKey}/{baseline}/pages`.

Indexing: `POST /helpers/reindex/{contentId}` — **only marks requirements ACTIVE/DELETED
and flags "needs excerpt"; excerpts and properties are gathered the next time a user
views the page.** A headless pipeline cannot rely on reindex alone to populate text.

### 6.6 Configuration

"Requirement Yogi has very little configuration." No RY permission scheme — requirements
inherit space permissions (view space → view requirements; edit pages → edit
requirements). The space **EXPORT** permission is reused as the gate for expensive
actions (Excel import tab, dependency matrix, coverage). An "Isolate Spaces" option
changes cross-space search and REST scoping.

System properties: `requirementyogi.jira.limit` (3000), `requirementyogi.jira.batch.size`
(100), `requirementyogi.applink.timeout` (30s + 0.1s/item), plus SQL entity-escape chars.

### 6.7 Limits (verbatim numbers)

| Limit | Value |
|---|---|
| Global limit (requirements, and baseline size) | **12,000** default, configurable |
| Import limit | Excel page says **2000**; performance page implies the global 12,000 — **the docs conflict** |
| Requirements per page | **150 recommended, 400 maximum** |
| Diff | **600 requirements** (stated as 5% of the global limit) |
| Traceability matrix page size | ~600 rows |
| Dependency matrix web view | 40,000 cells (200 × 200) |
| Dependencies per requirement | 3–20 expected |
| Properties per requirement | 10–50 expected |
| Cost at 50,000 requirements | ~20 ms per requirement on page save and on view |

### 6.8 Documented functional gaps in RY itself

- **No status field on requirements.** Customers fake it with third-party macros; there
  is no validation on status change. A rules engine is "planned, medium term".
- **No calculated fields** on Data Center.
- **No branching** — parallel 1.x / 2.0 editing is unsupported.
- **No variants/inheritance** on Data Center (Cloud has Variants).
- **Page-level restrictions are ignored** — marking a row as a requirement exports its
  text to the whole space.

These four are opportunities, not constraints, for a standalone clone.

---

## 7. Source pages read

`/data-center`, `/features`, `/properties`, `/requirement-types`, `/key-suggestions`,
`/renaming-requirements`, `/history`, `/the-requirements-yogi-macro`,
`/estimates-and-external-properties`, `/search-syntax` (+ `/cloud/search-syntax`),
`/traceability-matrix`, `/dependencies-dependency-matrix-and-coverage`, `/ry-reports`,
`/baselines-and-versioning`, `/blueprints`, `/customizable-blueprint-templates`,
`/diff-track-modifications-between-baselines`, `/database-schema`, `/word-import`,
`/excel-import`, `/excel-loop`, `/rest-api`, `/configuration`, `/limitations`,
`/performance`, `/administrator-s-guide`, `/tutorials`, `/apis`, `/integrations`,
`/requirement-yogi-for-jira`, `/ry-testing-and-compliance`.
