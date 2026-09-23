# 09 — Decision log

Every deliberate divergence from Requirement Yogi, and every place the RY documentation
is silent and we had to choose. Append only; supersede with a new entry rather than
editing an old one.

Format: **status** ∈ `accepted` | `superseded by RD-nnn` | `deferred`.

---

### RD-001 — Adopt RY's `(space, key, baseline)` identity model verbatim
**accepted.** Baselining duplicates rows in the requirement table with a baseline
discriminator; `NULL` means live (research §5.7). *Why:* it is the reason one query
engine serves live and frozen data, and every alternative (separate snapshot tables,
event sourcing) makes the query compiler twice as complex for no user-visible gain.
*Cost:* the requirement table is the largest in the system and every index must lead with
the discriminator.

### RD-002 — `page` becomes `document`
**accepted.** RY's `page`, `pageHistory` fields and "page" vocabulary are Confluence
artefacts. Reqforge uses `document` / `documentHistory`. `page` and `pageHistory` remain
as **deprecated aliases** that parse, warn, and compile identically, so queries copied
from RY documentation work.

### RD-003 — The query language is named **RQL**, not RYQL
**accepted.** "RYQL" is Requirement Yogi's Cloud-side name and is not ours to use. The
syntax is compatible; the name is not.

### RD-004 — Add calculated values: computed matrix columns and coverage percentages
**accepted.** RY states it cannot do this — "it cannot be used to display % coverage"
(research §4.2) and "no calculated fields" (§6.8) — and users work around it by exporting
to Excel. We add a deliberately tiny expression language (`04` §2.4) and report coverage
as count *and* percentage. *Risk:* expression languages grow. Mitigated by refusing
arbitrary expressions and cross-row references.

### RD-005 — Indexing extracts text synchronously
**accepted.** RY's reindex only marks rows and defers text extraction until a human views
the page (research §6.5), which makes headless pipelines unreliable. We extract during
indexing so a CI upload gets complete data and diagnostics in the response.

### RD-006 — `IS NOT NULL` is valid on every field
**accepted.** RY's Data Center docs restrict it to `baseline`; Cloud does not, and no
reason is given. The restriction is almost certainly an implementation artefact.

### RD-007 — Renaming never touches baselined rows
**accepted.** A frozen requirement keeps the key it was frozen with; the live requirement
carries a `renamedFrom` chain so history and diff resolve across the rename. *Why:*
invariant R2 (frozen rows are immutable) outranks naming consistency — a baseline that
silently changes is worthless in an audit. RY's rename rewrites page XHTML, which cannot
reach snapshots either, but its docs never state the consequence.

### RD-008 — Add requirement labels
**accepted.** A free-form, space-scoped label set on requirements, queryable as
`label = 'safety'`. RY has no equivalent. *Why:* the single most common request that
inline properties answer badly, because labels are many-valued, cross-cutting and not
part of the document's table structure.

### RD-009 — Variants / branching
**deferred to phase 3.** RY Data Center has neither and its docs say so (research §6.8);
Cloud has Variants. The identity model in RD-001 has room for a `variantId` alongside
`baselineId`, and the RQL grammar reserves `variant`. We do not build it in v1 because
every screen has to understand it and the v1 scope is already large.

### RD-010 — External properties are optionally baselined
**accepted.** RY never baselines them (research §2.6). But an external property is
frequently the approval state or the test result, which is exactly what you want frozen
in a compliance snapshot. We make it an explicit per-freeze option, defaulting to off so
RY-familiar behaviour is the default.

### RD-011 — Property names may contain spaces; searchability is separate
**accepted.** RY says "searchable columns can't contain a space" (research §2.5), which
pushes users into `Main_Category`. We store the name verbatim, derive a `searchName`, and
support both `@Main\ Category` and `@'Main Category'` in queries (`02` §2.3). Generated
links emit the quoted form.

### RD-012 — Baseline freeze materialises images
**accepted.** RY stores image URLs only, and its own docs warn that swapping the image
behind a URL changes what a baselined requirement renders, then advise users not to put
images in requirements (research §5.3). Advising users away from a feature is not a fix.
Freeze copies images into content-addressed storage and rewrites the frozen body.
*Cost:* storage, and a freeze step that can fail on unreachable images — which fails the
freeze loudly rather than silently producing a corruptible snapshot.

### RD-013 — `isModified()` compares title, body and inline properties
**accepted.** RY never states the field set (research §5.5 gap). We define it as the diff
default compare set with the diff default ignore set, so `isModified` and the diff view
never disagree. A requirement absent from the baseline is *not* modified.

### RD-014 — Authorship is recorded exactly
**accepted.** RY warns that concurrent editing records only one author and that a failed
job can attribute a change to whoever next reindexed the page (research §2.7). Because we
own the editor, history rows are written in the same transaction as the index update,
carrying the editing session's actor.

### RD-015 — Two declarative value rules: `PROPERTY_IN` and `PROPERTY_MATCHES`
**accepted.** RY has no rule expression language and its limitations page says not to
count on one arriving (research §6.8), so every customer fakes a status field with
third-party macros and no validation. Two narrow rule kinds give a space a validated
status vocabulary, a dropdown quick fix and `ruleStatus` filtering, without a scripting
language. *Explicitly out of scope:* cross-requirement rules and anything needing
evaluation order.

### RD-016 — Revalidate a whole space when a requirement type changes
**accepted.** RY states rerunning all validations across a space is not possible
(research §2.4) — an artefact of validation running inside page render. Ours runs in a
job with progress.

### RD-017 — Document restrictions are enforced on requirements
**accepted.** RY ignores page-level restrictions, so marking a row as a requirement
exports its text to everyone with space-view permission (research §6.7). For a defence or
regulated context that is disqualifying. Enforcement is a mandatory visibility predicate
in the repository layer, injected into the RQL compiler's output too (`07` §2.2).
*Cost:* every count and denominator becomes caller-dependent, which must be stated in the
UI so two people do not compare incompatible coverage numbers.

### RD-018 — RQL operator precedence is SQL-conventional and warned about
**accepted.** RY documents none. Ours: `->` › comparison › `NOT` › `AND` › `OR`,
left-associative. Compatible with every documented RY example, since they are all either
parenthesised or flat `AND` chains. The analyser warns on un-parenthesised `AND`/`OR`
mixing and the UI renders the implied parentheses.

### RD-019 — RQL string and identifier lexing is fully specified
**accepted.** RY documents no escape mechanism inside quoted strings and no way to match
a literal `%`. Ours: `\'` and `\\` inside strings, `\%` for a literal percent under `~`,
`_` is not a wildcard, curly and double quotes accepted on input and normalised. Keywords
and field names are case-insensitive; property names and values are not.

### RD-020 — RQL uses two-valued logic with absence-as-false
**accepted.** RY documents nothing. SQL three-valued logic would make
`NOT (@Category = 'Functional')` exclude requirements that have no `Category` at all,
which is never what a requirements engineer means. RY's own example
`NOT (jira ~ '%')` = "requirements with no Jira issue" confirms the reading.

### RD-021 — Traversal (`->`) is depth-capped at 4, evaluated by joins not recursion
**accepted.** RY documents no depth guarantee and no cycle handling. Repeated joins with
a hard cap terminate on cyclic graphs by construction; transitive matrix columns use a
recursive CTE with a visited-set guard and the same cap.

### RD-022 — No Atlassian-specific fields in RQL
**accepted.** `jira`, `jira@rel`, `project`, `projectName` and `excel` are not
implemented. `UNKNOWN_FIELD` maps them to an explanatory message rather than a
did-you-mean. Integration links (`08` §8) will introduce a generic `externalLink` field
when they land, not a vendor-named one.

### RD-023 — Table layout precedence: a header row wins over a header column
**accepted.** Spec `03` §2 defines the horizontal layout by "a table with a header row"
and the vertical layout by "a table whose *first column* is the header", but says nothing
about a table that has both, which is common as soon as someone styles the first column.
Ours: **if the table has a header row, the layout is horizontal**; the vertical layout
applies only when there is a header column and no header row. A table with neither is
treated as horizontal (the row is the scope) and every requirement in it carries the
`TABLE_HAS_NO_HEADER` warning of rule S4. *Why:* the horizontal layout is Requirement
Yogi's documented common case (research §2.1), and in a both-headers table the column
headers still name the properties, so the horizontal reading loses nothing. Requirement
Yogi's documentation does not state a rule; this is ours.

### RD-024 — `bodySearch` keeps its original case; `~` compiles to `ILIKE`
**supersedes the `bodySearchCI` sentence in `03` §3.1.** That spec step called for a
second, lowercased generated column for the `~` path. A generated column doubles the
storage of the largest text field in the largest table to buy what PostgreSQL's `ILIKE`
already does, and it would make `text = 'Exact'` (which spec `02` §5 defines as strict
equality) impossible to answer from the same column. Ours: one `bodySearch` column in
original case; `~` and `LIKE` compile to `ILIKE`; case-insensitive lookups are backed by
an index on `lower("bodySearch")`. The normalisation pipeline is otherwise unchanged:
strip markup → collapse whitespace → NFKC → `\x1f`-separated list members.

### RD-025 — Rule S3 keeps one row per key; the conflict is recorded against both documents
**accepted.** Spec `03` rule S3 said a key defined in two documents of one space keeps
"both rows", which invariant R1 (`01`) makes impossible: `(spaceId, upperKey, baselineId)`
is unique with NULL baselines colliding, so a space cannot hold two live rows for one key.
R1 is one of the four load-bearing decisions in `CLAUDE.md` and outranks the wording of
S3. Ours: the **first** definition keeps the requirement row; the second document's
marker creates no row and instead writes a `KEY_CONFLICT` error, and a mirror row is
written against the owning document, so the conflict is visible in both editors and on the
Conflicts screen. Nothing is silently picked and nothing is hidden, which is what S3 was
protecting. Diagnostics are persisted in `IndexDiagnostic`, rewritten on every index.

### RD-026 — `preventReusingDeletedKeys` decides whether deleted keys still block reuse
**accepted.** Spec `03` §4.2 uses "highest existing number" for both the suggestion
(step 2) and the reset action (step 4) without saying whether a `DELETED` requirement
counts as existing. Read one way, reset is a no-op; read the other, the sequence rewinds
under a type that is supposed to protect deleted keys. Ours: the flag decides.
`preventReusingDeletedKeys = true` (the default, and Requirement Yogi's behaviour per
research §2.3) counts every key the space has ever used, so the sequence survives
deletion. With it **off**, `DELETED` keys stop counting and become reusable — which is
what "reset sequence", gated on exactly that flag, exists to do. Keys captured in a
baseline always count, under either setting: a baselined key names a frozen requirement
forever (invariant R2) and must never be reissued.

### RD-027 — List-valued cells, property membership, and what `text` covers
**accepted.** Spec `03` refers to "list-valued cells" without defining one, and invariant
R3 describes set membership as a `\x1f` serialisation inside `bodySearch`. Three
decisions, because they are one mechanism:

1. **A cell is list-valued when its content is a bullet or ordered list**; each item is
   one member. Several paragraphs in a cell are formatting, not a list.
2. **Membership is stored as one `Property` row per member** (`valueIndex` 0…n) rather
   than as a separated string. `@Tag = 'item1'` is then an ordinary equality over rows,
   which the compiler can index, and research §3.7's "for list-valued properties `=` is
   set membership" holds without a string-splitting operator in SQL. `serialiseListValue`
   remains for the single-column case (`04` matrix cells).
3. **`bodySearch` excludes property values**, because `02` §4 and research §3.2 both say
   the `text` field "excludes properties". In a table layout `bodySearch` is the title
   field's text; in a paragraph, or in a headerless table where nothing is a property, it
   is the whole scope. Property values are searched with `@Name`, which is the point of
   having them.

Also: the column holding the marker is not itself a property when its cell contains only
the marker, and a column marked `isTitle` supplies the title instead of a property.

### RD-028 — `~` on document-id fields is a case-insensitive match on the id
**accepted.** Research §3.2 marks `~` as "undefined" for `pageHistory` and `links`, yet
§3.8 lists `pageHistory ~ 123` as a documented example, so the corpus requires it to
parse. Ours: `document`, `documentHistory` and `links` accept `~`, compiled as `ILIKE`
over the id, which is meaningful because Reqforge's ids are text. It costs nothing and
keeps every documented Requirement Yogi query working.

### RD-029 — What a link is, and what happens when its target is missing
**accepted.** Spec `03` §1.2 says a `requirementLink` inside a requirement's scope is a
dependency and elsewhere a citation, and research §4.1 gives the relationship its name
from the column header. Three cases neither document settles:

1. **A cell holding only links is a relationship column, not a property column.** Its
   cell produces dependencies and no `Property` row; a cell mixing text and links produces
   both, and its property value includes the linked keys as text. Without this rule every
   "Refines" column would also become a property whose value is a key, which then pollutes
   `@Refines` queries and the traceability matrix.
2. **A marker demoted by rule S1 or S2 stays a citation and never becomes a dependency.**
   A second marker in one scope is a user error (spec `03` rule S1 already reports it);
   inventing a relationship out of it would put a wrong edge into a traceability report,
   which is worse than recording a mention.
3. **Unresolved links are retried, not just retained.** Invariant P2 keeps the edge as an
   `UnresolvedDependency`; we additionally **promote** it to a real dependency the moment
   a requirement with that key is indexed, without re-saving the citing document. RY
   requires a reindex of the citing page. *Why:* the common case is writing the child
   before the parent, and a broken-links screen that only clears after unrelated edits
   trains people to ignore it.

Also decided here: a link crossing an `isolated` space boundary in either direction is
refused with an error diagnostic and kept as unresolved (spec `07` §3), so turning
isolation off later resolves it; and a link pinned to a baseline that does not exist warns
and falls back to the live requirement rather than failing the save.

### RD-032 — Relationship names are case-sensitive, and collisions are surfaced
**accepted.** Research §4 lists "relationship-name normalisation (case, whitespace)" as an
open gap, and coverage forces the question: is `Refines` the same relationship as
`refines`? Ours: a relationship name behaves **exactly like a property name** — trimmed
and whitespace-collapsed when the indexer reads it from the column header, stored
verbatim, and compared **case-sensitively**. That is what spec `02` §2.1 already decided
for property names and values, and `RD-011` for their storage; a relationship qualifier
(`to@Refines`) is the same syntactic class as a property qualifier (`@Category`), so
treating the two differently would be the surprising choice, and it would mean the query
grammar's case rules depended on which field you were querying.

Case-folding would also silently merge two names a space may have meant to keep apart,
which is the failure mode rule S3 and `RD-025` exist to avoid. Instead the coverage screen
**detects names differing only by case or whitespace and says so**, listing them as the
separate relationships they currently are and naming the fix (rename one in its document).
Surface the collision; never pick a winner.

### RD-033 — Coverage counts a link whose target the reader cannot see
**accepted.** Spec `04` §4.1 defines `covered(r, d)` as the requirements having at least
one dependency of that relationship and direction, and the acceptance check for this slice
requires that two readers with different access get different but internally consistent
numbers. That leaves one case undecided: a visible requirement whose dependency points at
a requirement the reader may **not** see.

Ours: it counts as covered. Rule X2 (`07` §2.2) already says the existence of a link is not
secret — only its target's content is — and the dependency matrix renders exactly that case
as `restricted`. The denominator is the population the reader can see, which the mandatory
visibility predicate produces for free, so `covered ⊆ population` and
`covered + uncovered = population` hold for every reader. The alternative — hiding the edge
— would make a requirement look uncovered to one reader and covered to another *with no
way to act on it*, since the reader cannot see or fix the thing they are being told is
missing.

### RD-034 — The report columns mini-syntax, spelled out
**accepted.** Spec `04` §5 gives the syntax and the field list but leaves two things
undefined, and research §4.5 only calls the options "query-string style".

1. **`original` is `description` resolved against the defining occurrence.** In Reqforge
   the two coincide: a requirement's text *is* the projection of the document version that
   defines it (overview, decision 2), so there is no "original versus current" distinction
   outside a baseline. The field is kept rather than refused so a column spec pasted from
   Requirement Yogi renders instead of erroring, and the two are documented as equal.
2. **Option semantics.** `format=short` renders keys alone and `format=page` renders the
   document title (the readable end of the same reference); `li=true` renders a list,
   `li=false` a comma-separated run, `li=last` only the final value; `duplicates=false`
   removes repeats within the field.

`jira` and `tests` are refused with an explanatory message rather than dropped, exactly as
`RD-022` handles Atlassian-specific RQL fields. An unknown field or an unusable option is
reported to the author and the rest of the spec still renders — a report with a typo in
one column should not be a blank box.

### RD-035 — "Use the last requirement definition" skips the enclosing definition
**accepted.** Spec `04` §5 says the switch "overrides the other and renders the *previous*
definition's description to avoid recursion", which admits two readings. Ours: it resolves
to the nearest preceding `requirement` marker **whose scope does not contain the report**.
A report written in a cell of FN-002's row therefore renders FN-001.

*Why:* it is the only reading under which both halves of that sentence are true at once —
"the previous definition" (not the current one) and "to avoid recursion" (a report cannot
render the requirement it is part of). The plain `useLastRequirement` switch keeps the
simpler rule: the nearest preceding marker or link, whatever it is. Either switch ignores
the query entirely (research §4.5), and resolution keys off a stable `id` on the report
node rather than a document position, so the same function serves the editor and any
server-side render.

### RD-036 — External property definitions belong to the instance, not to a space
**accepted.** `ExternalPropertyDefinition` is instance-global (spec `01`, research §2.6),
but every permission Reqforge has is space-scoped, and spec `07` §2.1's list of what space
`ADMIN` grants — requirement types, key locking, baselines, history settings, permissions —
never mentions them. So they are gated on the instance-wide `User.isAdmin` flag and
managed at `/admin/properties`, outside any space.

*Why:* a space administrator renaming or deleting a definition would be reaching into every
other space that files values against it. Setting a *value* stays space work and stays on
`EDIT`, exactly as `07` §2.1 says.

### RD-037 — The declared data type reaches the query engine through the context
**accepted.** Spec `02` §4 says `ext@<name>` is a "typed comparison, per Cloud", but the
analyser and the compiler are pure and cannot read a definition from the database. The
usecase loads the definitions and passes a name → data type map into `AnalyserContext` and
`CompileContext`, the same way the mandatory visibility predicate is passed today.

With a declared type, the analyser refuses a literal the type cannot hold
(`TYPE_MISMATCH`: `ext@RiskScore > 'high'`, a non-member of an enum, a date that is not
ISO, an ordered comparison on a yes-or-no property) and the compiler casts rather than
guessing from the shape of the literal: `::numeric`, `::date`, `::boolean`, each guarded by
a shape test so a value written before the type was declared makes the row not match
instead of failing the query. Under `~` the value is a pattern, not a value, so it is left
alone. An **undeclared** external property keeps the old shape heuristic — a definition may
simply not exist yet, and an unknown name is already an empty result rather than an error.

Changing a definition's data type is refused while values exist, for the same reason: the
promise the compiler relies on would otherwise be broken by rows it cannot reinterpret.

### RD-038 — An external value is single-valued per requirement
**accepted.** Inline properties are list-valued — one row per member, so `=` is set
membership (`RD-027`). External values are not: one row per `(requirement, definition)`,
enforced by a partial unique index (**invariant E2**), so setting a value replaces it.

*Why:* the five aggregations of spec `04` §2.1 (`sum`, `min`, `max`, `avg`, `count`) are
defined over one value per row, and "set value in bulk" is a set rather than a merge. Two
further invariants come with it: **E1**, an `EXTERNAL` row always carries its
`definitionId`, which is what makes `RD-037` sound; and **E3**, two definitions may not
differ only in case, because a value is looked up by its lowercased name.

### RD-039 — Setting a value in bulk needs `EDIT` and `EXPORT`
**accepted.** Spec `07` §2.1 grants "edit external property values" to `EDIT` and "bulk
operations" to `EXPORT`. Setting a value across a whole result set is both, so it requires
both; editing one cell needs `EDIT` alone.

*Why:* a reader deliberately denied the expensive, whole-result-set screens should not be
able to change a whole result set through a different door. The population is resolved with
the same visibility predicate a search uses (rule X3), so a bulk set can only reach rows the
caller could have listed for themselves.

### RD-040 — "Zero extra queries" is per requirement, not per save
**accepted.** Spec `06` §2.3 says "validation of one requirement must issue **zero**
additional queries — everything it needs is in the `IndexResult` or loaded in the job's
batch". A `REQUIRED_DEPENDENCY` rule with `direction: 'from'` asks whether anything depends
on this requirement, and that edge is declared in **another document**, so it can be in
neither place.

Our reading: the rule is about the *per-requirement* cost, and "loaded in the job's batch"
is the pattern to follow on the save path too. One batched query loads inbound edges for
the whole document before validation runs; validating each requirement then touches
nothing. The revalidation job does the same, three queries per page — properties, outbound
edges, inbound edges — however large the page is.

*Why not restrict `from` rules away:* "every requirement must be verified by something" is
the more common compliance rule of the two, and the schema already models both directions.
A rule kind that is half unusable is worse than one batched query per save.

This is what the acceptance test measures: the difference between saving with rules and
saving without is the same at 10 requirements and at 100.

### RD-041 — Two diagnostic codes the catalogue was missing
**accepted.** Spec `06` §4's quick-fix table names `PROPERTY_NOT_IN_VALUES`, which spec
`03` §7's catalogue does not list, and a failing `PROPERTY_MATCHES` rule had no code at
all. Both are now in the catalogue, both errors:

- `PROPERTY_NOT_IN_VALUES` — a `PROPERTY_IN` rule's value is not a member. Carries a
  dropdown fix over the allowed values.
- `PROPERTY_DOES_NOT_MATCH` — a `PROPERTY_MATCHES` rule's pattern does not match. Carries
  **no** fix: no value can be invented that satisfies an arbitrary regular expression, and
  offering one that does not work is worse than offering none.

Neither rule fires on an **absent** property: a value rule does not make a property
required, which is what `REQUIRED_PROPERTY` is for. A pattern that does not compile is
refused at the type editor, and — should one reach the validator anyway — is treated as a
rule that never matches rather than as a crash.

### RD-042 — A diagnostic carries its quick fix, as data
**accepted.** Spec `06` §4 says "fixes are ProseMirror transactions and must be
individually undoable", but does not say where the decision *which* transaction lives.

Ours: `Diagnostic` carries an optional typed `fix` — add this column to the table at this
path, promote this table's first row, set this cell to one of these values, link this
relationship in this cell, put an allowed key on this marker. The indexer already resolves
each requirement's scope, so it emits a `placement` the fix is derived from; the editor
turns the fix into exactly one transaction.

*Why:* the alternative is the editor re-deriving the repair from the diagnostic's code and
message, which puts spec knowledge in two places and makes every fix untestable without a
browser. As data, each fix is decided in a pure function and unit-tested, and the editor
holds only the mechanics.

Two consequences worth stating. A validation run with **no document in hand** — the
revalidation job — has no placement, so it decides the status and offers no fix; that is
correct, because there is nothing on screen to repair. And because diagnostics are
persisted and re-read when a document is opened, the fix is persisted with them
(`IndexDiagnostic.fix`), or the Fix button would only ever appear immediately after a save.

### RD-043 — Freeze fetches external images behind an SSRF guard
**accepted.** `RD-012` requires freeze to materialise images, and the editor has
`allowBase64: false` and no upload path, so every image in every document today is an
external URL. Refusing to fetch would make any document containing an image permanently
unfreezable; fetching user-supplied URLs from the server is textbook SSRF. So freeze
fetches, through one guarded client, and the guard is a separate module with its own test
table rather than a few lines inside the job.

The guard: an `http`/`https` allow-list; **every** address the host resolves to checked
against loopback, RFC1918, carrier-grade NAT, link-local (including the cloud metadata
address), IPv6 unique-local and IPv4-mapped forms; a literal address in the URL checked
the same way without consulting the resolver; redirects followed by hand, at most three,
with the guard re-run on every hop, because a permitted host redirecting to `127.0.0.1` is
the oldest bypass in this family; a 10-second timeout; a 10 MB cap enforced **while
streaming**, since `Content-Length` may lie; and an `image/*` content type required.

Anything refused fails the freeze with the image and the reason named, which is `RD-012`'s
"loudly rather than silently producing a corruptible snapshot". Storage is content-addressed
by SHA-256 and served through a route that re-checks the caller's `VIEW` on the space, so a
frozen body's image is read behind a permission check like every other piece of requirement
content (rule X3) — the digest is unguessable, but that is not the control.

### RD-044 — Refreeze ships with freeze, not after it
**accepted.** Spec `05` §3.4 is inside the §1–4 range slice 13 cites, and refreeze is the
same transaction shape as freeze under the same invariant-R2 trigger: delete and re-insert,
never update. Shipping it now means the **only** legal correction to a frozen baseline
exists, is audited and is tested, rather than a frozen baseline having no path back short
of delete-and-recreate — which would lose its number for ever (invariant B2).

Every refreeze writes a `BaselineRevision` recording who, when, why and the before/after
member counts, and the reason is mandatory. The history accumulates and is not erasable,
and a revised baseline says so on its own page.

### RD-045 — A baseline's report document is created with a live report in it
**accepted.** Spec `05` §2 says a draft has "optionally a report document" and
`Baseline.reportDocumentId` has always existed, but nothing created one — so `RD-031`'s
`$currentBaseline` resolution, built in slice 8, had no path that exercised it.

Creating a baseline with a report document now writes a real document titled for the
baseline, holding a heading and an embedded `report` node over `baseline = N`. The report's
query names the baseline explicitly so the document still reads correctly as plain text;
`$currentBaseline` is what a matrix an author embeds there later resolves through, which is
the mechanism that lets one saved matrix work inside every baseline report document.

### RD-046 — A baseline number comes from a counter, not from the surviving rows
**accepted.** Spec `05` §4 says the number is "sequential per space, assigned at creation,
immutable, never reused (invariant B2), **including after deletion**". Deriving it from
`max(number) + 1` over the baselines that remain cannot hold that: delete the highest and
the next baseline reuses its number, so two different snapshots could each be cited as
"baseline 5" in two different audits — precisely the ambiguity a baseline exists to remove.

The number therefore comes from `Space.nextBaselineNumber`, read and incremented in the
same transaction as the create. It only moves forward; deleting a baseline does not touch
it. A gap in the sequence, from a create that failed after taking a number, is harmless —
a reused number is not, so the counter is incremented first.

### RD-047 — `isModified()` and the diff are defined over the same stored columns
**accepted.** PLAN.md's acceptance for slice 14 is that the two "never disagree on the
same pair". `isModified()` must be a SQL predicate — spec `02` §6 places it in a query,
where it composes with `AND` and `OR` — while the diff classifier is TypeScript, so the
risk is drift, not disagreement on any one day.

Both are therefore defined over exactly three stored things: `title`, `bodySearch`, and
the `INLINE` property set ordered canonically. The pleasing part is that this *is* spec
`05` §5.2 step 3's default ignore set: `bodySearch` is markup-stripped, whitespace-
collapsed and NFKC-normalised (spec `03` §3.1), so formatting is already gone, an image
contributes no text, and a link's text survives while its href does not. Three ignore
options, one column comparison.

A digest column was considered and rejected: it would put the definition in a third place
and need recomputing whenever the compare set moved. Instead a fast-check property test
generates mutations and asserts the SQL and the TypeScript classify identically, so
shrinking names the exact pair if they ever part.

Turning an ignore *off* compares `bodyHtml` with images and hrefs tokenised — but
`isModified()` is always the default set (`RD-013`), so the two cannot be asked to differ.

### RD-048 — `baseline was N` asks whether a snapshot exists, and which change kinds this slice writes
**accepted.** Two things the research leaves open.

**`baseline was N`** is documented only as "matches a *previous* version's baseline"
(research §3.1) with no further definition. Spec `05` §5.3 pins the reading by using it:
a requirement absent from a baseline "is new, and is found with `NOT (baseline was N)`".
So it compiles to "a row with this key exists in that baseline" — the only reading under
which that sentence is true.

**History's change kinds.** Spec `05` §6 lists ten. This slice writes the nine whose
features exist — `CREATED`, `TITLE`, `BODY`, `PROPERTY`, `DEPENDENCY`, `TYPE`, `STATUS`,
`EXTERNAL_PROPERTY` and `BASELINED` — each at the site that already performs that change,
in its transaction, carrying the editing actor (`RD-014`). `KEY_RENAMED` is emitted by
slice 15, which owns renaming.

One consequence worth stating: in a horizontal table the title cell *is* the requirement's
text (spec `03` §3.1), so retitling writes both a `TITLE` row and a `BODY` row. That is
correct — two fields moved — and the tests pin it so it is not mistaken for a bug later.

### RD-049 — Retention protects the rows up to each relevant freeze
**accepted.** Spec `05` §6 says pruning "never removes rows that a frozen baseline depends
on", but a history row is not referenced by a baseline, so what that protects was
undefined.

Ours: a row is never pruned when it is dated **at or before** the `frozenAt` of a frozen
baseline that contains that requirement. Those rows are the story of how the frozen text
came to be, which is what an auditor reads beside the snapshot; churn after the freeze
ages out on the space's retention setting like anything else.

*Why not protect every row of a baselined requirement:* in a space where most requirements
end up baselined that makes retention a no-op, and spec `05` §6 calls this the largest
table in the system. *Why not protect nothing:* the frozen rows are self-contained, but
"prove it has not changed since" is answered by the snapshot **and** the trail, and
discarding the trail discards half the answer.

### RD-050 — A rename rewrites the document and reindexes, in one transaction
**accepted.** Spec `03` §5 requires propagation into "every `requirement` and
`requirementLink` node in every *current* document version" but does not say how. Two
readings were open: patch the rows and the stored JSON surgically, or rewrite the JSON and
put it back through the ordinary indexing path.

Ours: rename the rows, rewrite the key in each affected document's ProseMirror JSON, write
a **new** `DocumentVersion` authored by the renamer, and run the normal index pipeline —
all inside the one transaction.

*Why:* this is not tidiness, it is correctness. `applyIndexResult` reconciles requirements
by key (contract I2) and contract I3 marks a key that vanishes from its document as
`DELETED`. A rename that moved the row but left the document saying the old key would, on
that document's next save, **resurrect the old key as a new requirement and delete the
renamed one**. Because the rewritten content is byte-identical apart from keys, the index
result is identical apart from keys, so reindexing costs a pass and buys agreement with
contract I2 by construction rather than by a second copy of the indexer's rules.

*Why a new version rather than patching the current one:* `DocumentVersion` is immutable
(invariant D1, spec `01`), a pinned one is undeletable, and a reader who has cited a
version should not find its text changed underneath them. The cost is one version row per
affected document, and the benefit is that the rename shows up in each document's history
where an editor will look for it.

*Consequence for the rename job:* it is the first job that is a single transaction, so it
does not page. `registerJobHandler`'s page source became optional rather than pretending to
offer one, because a page source is read outside any transaction.

### RD-051 — Historical keys live in `RequirementKeyAlias`
**accepted.** `RD-007` promises the live requirement carries a "`renamedFrom` chain", and
the schema has carried a single `Requirement.renamedFrom` column since slice 0. One column
is not a chain: after `FN-1 → FN-2 → FN-3` the key `FN-1` is lost.

Ours: `RequirementKeyAlias(spaceId, key, upperKey, requirementId, renamedAt, actorId,
jobId)`, unique on `(spaceId, upperKey)`. `renamedFrom` stays as the immediate predecessor
for display. Any former key resolves to its current requirement in one indexed lookup, so
a link written before a rename and a key read off a frozen baseline both still land.

The unique index is also the rename's **collision check**: a key an alias still claims is
not free to hand to a different requirement, because doing so would silently re-point every
reference written before the rename. That is the one case where reusing a key is worse than
refusing it.

Two rules make the table behave:

- **A live requirement wins.** An alias for a key some live requirement currently wears is
  ignored on read and cleared on write; the requirement wearing the key answers for it.
- **The most recent claim wins.** A swap inside one batch (`A → B`, `B → A`) leaves both
  requirements having held both keys, and the unique index allows one owner per key. The
  older record is dropped. This is the only case that can produce the ambiguity the
  collision check otherwise prevents, and it is unavoidable: the alternative is refusing
  swaps, which are the most ordinary renumbering there is.

*Why not a JSON array on the requirement:* resolving an old key would mean scanning or
indexing JSON, and it puts a second copy of the identity model on the row.

### RD-052 — Saved queries are rewritten by AST-located splice; frozen provenance is not rewritten
**accepted.** Spec `03` §5 says a rename propagates to "every saved matrix query that
references the key literally", which needs a definition of *literally* and a list of what
counts as a saved query.

Ours: parse each query, walk the AST, and replace only the string literals compared against
`key` or `key_case_sensitive` with `=`, `!=` or `IN`, splicing by offset into the original
text so spacing and layout survive. `key ~ 'FN-%'` is a **pattern, not a reference**, and is
left alone: after the rename it still means "every key starting FN-", and rewriting it
would change the question. A query that no longer parses is reported, never mangled —
textual substitution is precisely what this rule exists to avoid, since it would rewrite a
key inside a property value or inside a longer key that merely starts with it.

In scope: `SavedMatrix.query`, `SavedSearch.query`, and the `report` node's `query`
attribute (which lives in a document and so is rewritten with it).

**Not** in scope, deliberately: `Baseline.sourceQuery`, `BaselineDanglingDependency`'s
`childKey`/`targetKey`, and a `requirementLink` pinned with a `baselineNumber`. All three
describe a frozen snapshot. Under `RD-007` a baseline keeps the keys it was frozen with, so
rewriting them would change a baseline's provenance — the one thing a baseline exists to
hold still.

### RD-053 — Renaming requires `ADMIN`
**accepted.** Requirement Yogi restricts renaming to a global administrator or a group
explicitly granted "Requirement rename" (research §2.8). Reqforge's permission table
(spec `07` §2.1) had no rename row; it gains one, on `ADMIN`.

*Why not `EDIT`:* a key is a requirement's identity, and of the four things `CLAUDE.md`
names as expensive to undo, this touches the first. *Why not `EDIT` + `EXPORT`, the
existing bulk-operation rule of `RD-039`:* a bulk property set changes values, which any
later edit can change back; a rename changes what everything else refers to.

### RD-054 — A rename is capped at 2,000 requirements and 1,000 documents
**accepted.** Spec `03` §5 requires one transaction and spec `07` §4 lists no rename limit
— ours, since RY documents none.

A single transaction is the spec's promise and an unbounded one is an outage: every
affected document is rewritten and reindexed inside it. Both caps are hard limits, refused
with the limit named in the message, as spec `07` §4 requires. They sit well below the
12,000-per-space limit so an accidental "select all matching" cannot take the instance out.

A second mechanical consequence: the keys move in **two phases**, every renamed row first
to a sentinel and then to its target. The partial unique index on `(spaceId, upperKey)
WHERE "baselineId" IS NULL` is not deferrable and Postgres checks it row by row, so a
permutation cannot be done in one pass. The sentinel uses `~`, which is outside the key
alphabet of spec `03` §4.1 and so can never collide with a real key.

### RD-055 — `newKey`, `newSpaceId` and `status = MOVED` stay unimplemented
**accepted.** These three have had no reader and no writer since slice 0, and the schema
comment conflated them with `renamedFrom`. They are the forwarding pointers of a
cross-space **move** — a different operation from a rename, which stays inside its space —
so slice 15 does not touch them, and the comment now says which is which. Recorded so the
next person to find them does not read them as an unfinished rename.

### RD-056 — View restrictions inherit down the document tree; edit restrictions do not
**accepted.** Spec `07` §2.2 gives a document `inherit` or an explicit allow-list but never
says what `inherit` inherits. Until slice 16 it meant "unrestricted", so a page created
under a restricted parent was public to the whole space — exactly the leak `RD-017` exists
to close.

Ours, Confluence's model, which RY users know:
- A document is viewable only if its own view list **and** the list of every restricted
  ancestor admit the reader.
- An edit list restricts only its own document. It never widens a view list, because you
  cannot edit what you cannot see.

A view or edit list restricts only when the document is `EXPLICIT` and the list is
non-empty. With no edit grants, every viewer who has space EDIT may edit.

*Mechanism.* The ancestry is materialised in `DocumentViewGate(documentId,
gateDocumentId)`: one row per restricted ancestor-or-self. The predicate stays a single
indexed `NOT EXISTS` rather than a recursive walk per requirement row. It is derived data,
rebuilt for the subtree whenever a restriction changes or a document is created or moved,
because those are the only events that change a document's ancestry or its ancestors'
lists. The migration backfills it, and this is the moment a child of an already-restricted
page stops being public.

### RD-057 — Editors set restrictions, but cannot lock themselves out
**accepted.** Spec `07` §2.2 does not say who controls a restriction, and RY has no
equivalent because it ignores restrictions.

Ours:
- Anyone who may currently edit the document may change its restrictions: space EDIT plus
  the document's own edit list.
- A change that would remove the actor's own view or edit access is **refused**, not warned
  about, because nobody but an administrator might be able to undo it.
- An explicit restriction with nobody on the view list is refused for the same reason.

*Why not ADMIN only:* an author who cannot protect their own draft without asking an
administrator will not use restrictions at all.

### RD-058 — ADMIN cannot read restricted content, but can unlock it
**accepted.** Rule X1 says a restriction applies "everywhere", and a read bypass for
administrators would make it advisory for them. There is none: space ADMIN gets a 404 on a
restricted document like anyone else.

What ADMIN gets instead is a **Restricted documents** screen that lists restricted documents
*by title only*, with a *Remove restriction* action. That is how a document restricted to
someone who has since left is recovered. Every unlock is audited.

The title is shown because it is the minimum needed to recognise the document, and
because the tree shows the same title to anyone the document admits. Unlocking only
accepts a document that *is* restricted in the space, so the action cannot be used to
probe for document ids.

### RD-059 — Rule X4 is an intersection of the frozen and the current gates
**accepted.** Rule X4 says a baseline "captures the restriction state at freeze time":
loosening later must not expose baselined text, while tightening must apply. Before this
slice frozen rows were checked against their origin document's *current* restriction, so
loosening exposed them.

Ours:
- At freeze, the gates of each member's origin document, and those gates' view grants,
  are copied into `BaselineViewGate` / `BaselineGateGrant`.
- A frozen row is visible only if it passes **both** the frozen gates and the current ones.
  That is exactly X4: loosening changes only the current half, and tightening fails it.
- The copy is taken as the freeze job completes, before the baseline is marked frozen. A
  refreeze replaces it, because a refreeze is a new freeze.
- Baselines frozen before this slice are backfilled from the restriction state of the
  migration, which is what they were being checked against anyway.

A freeze still closes over parents the person freezing cannot see, as `closeOverParents`
requires. The captured rows are protected by their frozen gates, and every member count is
per viewer.

### RD-060 — Classification labels are an ordered, instance-wide list
**accepted.** Spec `07` §2.3 calls labels "free text configured per installation" and
then needs "the highest" of several, which free text cannot provide.

Ours is `ClassificationLevel(name, rank)`, owned by instance administrators. Space and
document labels are chosen from the list, so a typo cannot create an unranked label. The
migration turns existing free text into levels in first-seen order, for an administrator
to reorder. A label name may not contain `&`, which is ExcelJS's header/footer control
character.

Effective labels:
- **Requirement:** the higher of its space's and its origin document's ("inherited by
  requirements").
- **Document:** the highest of its own, its space's, and the requirements its links, reports
  and saved matrices render **for this reader** ("propagated upward"). What an embedded
  query shows depends on who reads it, so its label does too.
- **Export:** the highest over the space and every row in the file, written into the first
  row and into the header and footer of **every** sheet. The label is known only after the
  last page, so the workbook is stamped last.
- **Baseline:** the highest over its members, captured at freeze.

### RD-061 — Permission administration
**accepted.** Before slice 16 space permissions came only from the seed.

Ours:
- Space ADMIN grants and revokes VIEW/EDIT/EXPORT/ADMIN to a person (by email) or a group on
  a Permissions screen.
- Any permission implies VIEW, because `requireSpace` checks VIEW first and "EDIT only"
  would silently do nothing.
- A change that leaves the space with no effective administrator is refused. An ADMIN group
  counts only through its members. The check and the write share one serializable
  transaction, so two administrators demoting each other at once cannot both pass.
- Instance administrators manage groups and their members. Deleting a group takes its
  memberships and restriction grants with it.
- Every change is audited.

### RD-062 — What the audit log covers
**accepted.** Spec `07` §6 says every state-changing operation writes an audit row, and
names six an auditor will ask about.

**Audited:**
- The six named ones: freeze, refreeze, rename, restriction change, permission change, and
  export. An export is audited when queued *and* when downloaded.
- Group changes and classification levels and labels.
- Requirement type create, update and delete, and key-sequence resets.
- History settings and prunes.
- External property definitions.
- Document move and delete, and baseline rename and row discard.

Instance-wide changes carry no space.

**Not duplicated:**
- Document saves, which are already immutable versions with an author.
- External value edits, which history records per requirement.

A read-only **Audit log** screen serves space ADMIN, filterable by operation, actor and
date. Rows hold identifiers and parameters, never requirement text, so reading them needs
ADMIN rather than visibility of everything they mention.

Only the person who queued an export may download it. The file holds what *they* could
see, which another EXPORT holder may not be allowed to. Before this slice any EXPORT holder
could fetch any export by its job id.

### RD-063 — Rename propagation reaches documents the renamer cannot see
**accepted.** A rename (ADMIN) must still rewrite a link inside a restricted document, or
`RD-050` breaks: that document's next save would resurrect the old key.

The rewrite is a system propagation. Nothing of the document is shown to the renamer, and
the new version's message names the rename. What the renamer may *select* is limited to
requirements they can see.

Collision messages read "this key is not available in this space", both for a live key and
for a former key. Naming which would confirm that a hidden requirement exists.

### RD-064 — A hidden requirement or document answers 404, never 403
**accepted.** Rule X2 says hidden content is "omitted, not redacted". A 403 would confirm
existence, which is itself a redaction.

So the following all read exactly like a key or document that does not exist:
- the requirement page, the popup and the alias redirect;
- a hidden document's page, history and versions;
- the changes attempted against a hidden document.

A dependency on a hidden requirement keeps its **key** and shows `restricted` in place of
its title and status, with no link. This matches the matrix column and reports: "the
existence of a link is not itself secret, its target's content is."

Keys are not treated as secret anywhere: key uniqueness is space-wide, and the indexer
still resolves a link to a hidden key. Titles, bodies, properties, citing documents and
counts are what the predicate protects.
