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
