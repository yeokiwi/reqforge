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
**superseded by RD-032.** RY's `page`, `pageHistory` fields and "page" vocabulary are Confluence
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

---

## Decisions from the screencast (2026-10-08)

The vendor screencast (`docs/research/requirement-yogi-video.md`) showed the running
product and contradicted the written documentation in three places. These entries record
what changed.

### RD-023 — Requirement keys are Unicode-permissive
**accepted. Supersedes the ASCII key rule previously in `03` §4.1.**
The docs say keys accept only letters, digits, `_`, `-` and `.`. The product accepts
anything except `/` and `\` — the video shows `日本語の文字-001`, `حروف عربية-001`,
`REQ-004(§2.5)`, `REQ-!@#$%%^*()_-002` and `REQ 005` as explicitly valid, and rejects
only `REQ/006\`. We match that, with a short exclusion list (path separators, invisible
characters, leading/trailing whitespace, >200 chars) and a non-blocking `KEY_AWKWARD`
warning for keys containing a space, `'`, `%`, or mixed scripts.

*Why it matters more for us than for RY:* a defence or multinational programme writing
in Japanese or Arabic, or numbering clauses as `§2.5`, is locked out by an ASCII rule.
*Cost:* Unicode case folding rather than `toUpperCase()`, percent-encoded keys in URLs,
`%` colliding with the `~` wildcard, and six awkward keys permanently in the query
fixture set (`02` §10 category 7). All cheap, and all cheaper now than after launch.

### RD-024 — `describe()` and `complete()` are analyser outputs
**accepted.** The search screen renders the *effective* query in English below the box,
including the defaults the analyser injected, and `Ctrl + Space` completes fields and
property names. Both are generated from the AST in `src/domain/ryql/`, not in the UI —
a description produced by any other route will eventually disagree with the compiler.

*Why:* "why is my requirement missing from these results" is the main support cost of
any query language, and the answer is almost always an invisible injected default. The
echo also discharges `RD-018`'s obligation to make precedence visible.

### RD-025 — The bulk-insert dialog states its mode explicitly, and pads for you
**partly superseded by RD-033** — the mode radio and all-or-nothing validation stand;
the dialog layout, and the preview line, do not. The dialog carries a mode radio — *use the selected text as keys* versus
*generate numbers automatically* — rather than inferring which the user meant. It shows
the line count before committing, previews the generated keys, and validates the whole
selection before inserting anything; a partial bulk insert is not a state anyone can
reason about.

One improvement on RY: zero padding is **derived from the pattern and applied
automatically**. RY's dialog tells the user to remember leading zeros so keys sort
correctly. Telling the user to do something the software knows how to do is a defect.

### RD-026 — Requirements may live in headings, and keep their outline position
**accepted.** The video shows requirements in headings at several levels, a layout the
written docs never mention. A heading requirement's title is the heading text only, not
the section beneath it. We additionally store `headingLevel` and `sectionPath`.

*Why the extra fields:* the document outline is structure the author already created.
RY discards it; keeping it gives us section-scoped queries and a free tree view in the
traceability matrix for no authoring effort.

### RD-027 — Inline transform works across a whole space
**accepted.** The view-mode dialog offers three independent options: make links for a
key in this document, make links for it **in this space**, and create definitions for
every regex match in this document with a live occurrence count. The written docs
mention only the document scope; the space-wide option is the one that saves an
afternoon after a Word paste. Above 200 occurrences the action requires an explicit
confirmation, and the regex runs against rendered text only, so running it twice is
idempotent.

### RD-028 — One popup component, one badge vocabulary
**accepted.** The requirement popup and the link badges (`ORIGINAL`, `LINK`,
`PARENT ↗`, `CHILD ↘`, `TESTS`) appear in documents, search results, matrices and
reports. They are specified once in `10-ui-reference.md` and implemented once.

The direction arrows are load-bearing, not decoration: dependency direction is the most
misread concept in the product (invariant P1), and RY labels every edge with ↗ or ↘
rather than relying on the words parent and child.

### RD-029 — Adopt RY's URL shape
**accepted. Supersedes the `/s/{spaceKey}/r/{key}` scheme. Baselined form superseded by RD-044.**
`/requirements/{SPACE}/{KEY}`, with `@{baselineNumber}` for a frozen version, matching
the URL visible in the video's status bar. Short, guessable and pasteable into a ticket,
which is most of what a requirement URL is for.

### RD-030 — An eleventh spec file
**accepted.** `CLAUDE.md` budgets ten spec files. `10-ui-reference.md` makes eleven.
The screencast is primarily UI evidence, four agents build against it, and the
alternative was duplicating the popup and badge definitions across three domain specs
where they would drift. The budget stands at eleven; a twelfth needs its own entry.

---

## Decisions from the GUI directive (2026-10-08)

Direction from the product owner: *the specifications and requirements follow the
graphical user interface shown in the video.* A second pass over the screencast captured
every distinct screen (`requirement-yogi-video.md` §10a). These entries record what that
changed.

### RD-031 — The GUI follows the vendor screencast
**accepted.** Screen layout, controls and their order, UI copy, defaults, keyboard
routes and colour roles reproduce what the video shows. `10-ui-reference.md` is the
contract, with a verbatim copy deck (§13) that tests assert against.

Three things are explicitly *not* reproduced, and the spec says so in a table at the top
of `10` rather than leaving them to judgement:

1. **Identity.** Product name, logo and wordmarks are ours. No third-party branding,
   "Powered by" footers, or vendor names in our chrome. Copy that names the vendor
   (`Requirement Yogi (Alt + Shift + R)`) substitutes our name.
2. **Behaviour the decision log already overrides.** Most visibly `RD-017`: the video
   demonstrates restricted pages leaking their requirements; ours do not. Following the
   GUI is not following the defect.
3. **Vendor-named integrations** (`Jira Issue/Filter`, the `JIRA` badge) keep their slot
   and are relabelled generically when integrations ship.

*Why this rule and not "inspired by":* users moving from Requirement Yogi carry muscle
memory — where `Create` is, what `Alt + Shift + R` opens, which checkbox starts ticked.
Fidelity is what makes migration free. *Cost:* some choices we previously made on taste
are reversed (RD-032, RD-033), and the GUI inherits a few rough edges we would not have
designed, such as the `TRACEABILITY MATRIXES` heading.

### RD-032 — The UI says "page", "macro" and "Estimates"; so does RQL
**accepted. Supersedes RD-002. The "Estimates" tab label is superseded by RD-038.**
The video's vocabulary is "page" (Pages, Page tree, "on this page"), "macro" (Insert
the Requirement macro, Macro suggestions, Other macros) and "Estimates" (the tab).
The UI uses those words. RQL follows the UI: `page` and `pageHistory` are the native
field names again, with `document` and `documentHistory` accepted as aliases — which
also means queries copied out of RY's documentation work unmodified.

Internal names do not change: the domain entity stays `Document`, the editor node stays
a requirement *marker*. Code is written for engineers; the UI is written for users; the
two vocabularies are mapped once, in the copy deck.

### RD-033 — The bulk-insert dialog has the video's two variants and no preview line
**accepted. Partly supersedes RD-025.**
Empty-cell selections get **Prefix and first number**, two fields pre-filled from the
next suggested key with the number already zero-padded. Text selections get the **Mode**
radio and an optional **Prefix**. The preview line RD-025 added is dropped — it is not in
the GUI, and the pre-filled padded number already shows the user what will be generated.

What survives from RD-025, because it is behaviour, not layout: the count is a promise,
validation is all-or-nothing, and a numbers-only selection requires a prefix.

### RD-034 — The Restrictions dialog is reproduced; its effect is not
**accepted.** The dialog's three modes, subtitles, entry list, `Everyone — Has no
access` row and disabled-until-changed `Apply` are reproduced verbatim. The schema's
restriction modes now mirror them (`NONE`, `EDIT_RESTRICTED`, `VIEW_EDIT_RESTRICTED`).

The effect differs (`RD-017`): requirements on a restricted page are restricted with it.
Because the GUI is identical to one that behaves the other way, the dialog adds one line
whenever the page defines requirements — *"Requirements defined on this page follow these
restrictions."* A user who knows Requirement Yogi must not be left to assume RY's
behaviour from RY's dialog.

### RD-035 — Elements shown in the video that we omit or defer
**accepted.** Every element in the video is accounted for in `10`, with a status.

| Element | Status | Reason |
|---|---|---|
| App switcher grid | not built | single-product installation |
| `Blog` sidebar item | not built | no role in a requirements tool; removed rather than left dead |
| `Like` / "Be the first to like this" | not built | social signal with no role in a specification |
| `People` directory | later | |
| Notifications bell | later | `Watching` ships in v1 and emails |
| Page labels, comments | later | features in their own right; footer slot reserved |
| `Gallery`, `Jira Issue/Filter` in the insert menu | later | |
| Collaborator invite `+`, real-time co-editing | later | v1 shows presence and detects concurrent saves |
| `Excel` tab | superseded by RD-038 | the newer build has no Excel tab; Excel import is reached from the External properties tab |
| `Tests:` section of the popup | later | needs the testing module |

### RD-036 — Page URLs
**accepted. Extends RD-029.** Pages live at `/spaces/{SPACE}/pages/{pageId}`, with
`/edit` for the editor. Requirement URLs stay `/requirements/{SPACE}/{KEY}`, as seen in
the video's status bar.

### RD-037 — The copy deck is a contract
**accepted.** `10` §13 lists every string reproduced from the video with an id. Strings
are loaded from that deck, never inlined in components, and a test asserts each id
renders its exact text. Changing a string is a GUI change and needs a decision here.


---

## Decisions from screencast set 2 (2026-10-08)

Three further vendor videos — baselines, Excel import, administration
(`docs/research/requirement-yogi-videos-2.md`). They show a newer RY build than set 1 and
cover screens set 1 never opened.

### RD-038 — Where the builds differ, follow the newer one
**accepted. Supersedes the tab bar of RD-032 and the Excel-tab row of RD-035.**
The tab bar is `Search · Coverage · Dependencies · Traceability · Baselines · Diff ·
Reports · External properties`. The newer build renamed Estimates to External properties
— which the written docs also say happened — added Reports, and moved Excel import into
links at the foot of the External properties tab. Following the older build would mean
reproducing a layout the vendor has since replaced.

### RD-039 — A bare word is a query
**accepted.** `KEY` in the search box searches keys and text and echoes *"Requirements
containing 'KEY'"*, as the administration video shows. Rule in `02` §3.2: free text is an
input with no operators, parentheses, `@` or quotes that does not parse as a field
predicate. A single quoted string is free text too, as the escape hatch. Focusing the
empty box lists the user's last 10 queries.

### RD-040 — External property types are the five the product shows; names are permanent
**accepted.** `STRING`, `FLOAT`, `INTEGER`, `BOOLEAN`, `DROPDOWN` — labelled Text,
Decimal number, Integer, Boolean, Dropdown in administration. Our earlier `DATE`, `ENUM`,
`NUMBER` and `TEXT` are dropped: dates are text in ISO form (which RQL already compares
correctly, `02` §5), and DROPDOWN is the enum. *"Once created, it is not possible to
rename external properties"* — adopted, because a rename silently breaks every saved
query that names the property. Deleting a definition deletes its values instance-wide,
after a confirmation stating the count; the earlier rule refusing deletion while values
exist is dropped.

### RD-041 — Freezing marks page history, without creating a version
**accepted.** RY's page history shows `Baseline "Baseline 3" for Requirement Yogi`
against a version — it creates a new page version to carry the comment. We annotate the
pinned version instead, so the marked version and the frozen content are the same
version. The history screen shows the marker in the Comment column and disables Delete
on that row.

### RD-042 — A key suggestion is prefix + padded number + suffix
**accepted. Replaces the `FN-###` template in `03` §4.2 and `06` §1.**
That is the model RY's Key suggestions screen exposes, with `Add`, `Delete` and `Search`
per row. Settings and defaults are RY's, verbatim: Use global settings (on), Links across
spaces (on), Prevent reusing deleted keys (**off** — our schema had it on), Generate
global keys (off), Lock keys (off). Lock and reuse are space settings, not type fields.

### RD-043 — Rename and baseline deletion: space admins, plus groups who can edit
**accepted.** Both default to space administrators. Administration lists groups whose
members may also act — **only if they can edit the space**. The export setting (*Allow
export for anyone who can view requirements*, default on) gates Excel/CSV export jobs
only; the API remains available to anyone who can view, as RY's own note says. This
replaces the written docs' "global admin or configured group" for rename.

### RD-044 — Baselined versions are `KEY vN`, with the number in the URL
**accepted. Supersedes RD-029's `@N` form.**
*"Baselined requirements take the number of the baseline in the key, and in the URL."*
Display `BR-01 v1`; URL `/requirements/{SPACE}/{KEY}/{N}`, mirroring the record-id
grammar `SPACE/KEY/N` (research §2.7). A baseline's short id is `{SPACE}-{N}`. Baselined
rows are grey in Search and read-only everywhere.

### RD-045 — The baseline wizard's unshown parts are ours, and say so
**accepted.** The videos never show the Dependencies step or any status but `DONE`. The
Dependencies step offers *Include parent requirements* (off) from the written docs; a
draft shows `DRAFT`. One copy fix: RY's step 1 states *"This action will create a page
with a summary of the baseline"* even when the default *Baseline page: None (simple)* is
selected. We show that line only when a page will actually be created — reproducing a
false statement is not fidelity.

### RD-046 — Long-running tasks survive closing the page
**accepted.** RY's reindex tells the user *"For the task to progress, you must keep this
page open."* Ours run as jobs (`00` decision 4); the task view reattaches from the job
id. The view itself — Time Elapsed, Time Remaining (estimated), Completion, Stop and
cancel — follows the video. The same jobs appear on the Queue screen, modelled on RY's
message queue: statistics per queue, filters, retry, delete, 20,000 retained, and a
read-only Personal queue for every user.

### RD-047 — Requirements in collapsible blocks are always indexed
**accepted.** RY's administration video demonstrates a requirement inside an Expand
macro showing as DELETED, presented as an indexing problem to fix by reindexing. Ours
indexes every container (`03` rule S5); the deleted-requirement page (`10` §22) exists
for requirements that really were removed.

### RD-048 — Administration and space settings follow the video's structure
**accepted.** Administration tabs in RY's order — Getting started, Options, Queue,
Integrations, Properties, Key suggestions, Upgrade tasks, Logging, Support, Usage
metrics, Tutorials / checklist — each marked v1, later or not built in `10` §19. Space
settings get a Reqforge tab with Options, Reindex, Key suggestions and Trash. Usage
metrics are computed locally: *"We don't do telemetry, these metrics are just for you."*
RY's indexing-engine selector has no equivalent and is not built.

### RD-049 — Excel import is specified now, built in phase 3
**accepted.** The Excel video gives enough to specify the feature completely: upload with
a 4,000-requirement cap, per-sheet opt-in and category, column roles `KEY`,
`DESCRIPTION`, `PROPERTY` (named) and `-`, read-only imported requirements, and *"N
requirements created. File processed in N ms"*. Recorded in `10` §25 so the phase-3 build
needs no new research. The 4,000 figure also settles the written docs' conflict.

In v1 the recommended path for Excel content is the one the video's own tips give:
paste the sheet into a page, select the key column, `Alt + Shift + R` — the bulk dialog's
*Use selected text as keys* mode.

---

## Decisions from slice 0 — walking skeleton (2026-10-09)

Slice 0 is the first code. The videos show Confluence's chrome around Requirement Yogi, so
sign-in, accounts and the shell's edges are things the research notes never document. These
are **design choices, not reproductions**: nothing below is claimed to be what Requirement
Yogi does.

### RD-050 — Sign-in is email + password, with server-side sessions
**accepted.** `PLAN.md` slice 0 says "auth (email + session)" and nothing more. Chosen:

- Email + password. Emails are stored lower-cased (a `CHECK` enforces it) and compared after
  trimming and lower-casing.
- Passwords are hashed with **scrypt** (`N=2^15, r=8, p=1`, per-password salt, NFKC-normalised
  input) from `node:crypto`: memory-hard, and no native dependency to build in CI or Docker.
  The stored form is self-describing (`scrypt$N$r$p$salt$hash`) so parameters can be raised later.
- Sessions live in the database. The cookie holds a random 256-bit token; the database stores
  only its **SHA-256**, so a leaked database yields no usable sessions. The cookie is
  `HttpOnly`, `SameSite=Lax`, `Secure` in production, with a **fixed 14-day lifetime** — no
  sliding renewal, because a server component cannot refresh a cookie and extending only the
  row would outlive the cookie.
- Sign-in answers *"Incorrect email or password."* identically for an unknown address and a
  wrong password, and burns the same CPU for both. After **8 failures in 15 minutes** for one
  address it answers *"Too many attempts…"*. The throttle is in-process and keyed by email: it
  stops guessing against one account but lets someone lock a *known* address out for the
  window. A shared store replaces it when there is more than one server.
- `?next=` is honoured only for same-site relative paths (open-redirect protection).

*Cost:* no SSO, no password reset, no MFA. They are not in the plan; each is its own slice.

### RD-051 — Space permissions are an explicit set; a hidden space is a 404
**accepted. Extends `07` §2.1.** The spec lists `VIEW`, `EDIT`, `EXPORT`, `ADMIN` but not how
they combine. Rules: a user's permissions in a space are the **union of every membership that
applies** to them (direct, or through a group); **no permission implies another**; and every
action other than viewing **also requires `VIEW`** — an `EDIT` grant on a space you cannot see
does nothing. A space the caller cannot `VIEW` **does not exist** for them: absent from lists
and answered with **404, not 403**, indistinguishable from a space that was never created
(rule X2's "omitted, not redacted", applied to spaces).

**Instance administrators gain no access to space content.** `isInstanceAdmin` opens
Administration, the Queue and global property definitions (`07` §2.4); it does not bypass
space permissions, which is consistent with `RD-017` — a tool that holds specification text
for regulated work should not have a role that reads everything by default. *Cost:* an
instance admin who needs a space needs a membership in it, like anyone else.

### RD-052 — Shell gaps the screencast leaves open
**accepted. Extends `10` §2–3; strings in `10` §13.1.**

| Question | Choice | Why |
|---|---|---|
| What does `Create` do in slice 0? | Outside a space, or in a space the user cannot edit: a picker of the spaces they can edit. Inside an editable space: the button holds its slot, **disabled**, until pages exist (slice 1) | `10` §2 says "new page in the current space, or space picker outside one"; there are no pages yet |
| How are `later` elements drawn? | `People` and `🔔` are drawn and inert (`aria-disabled` / a disabled button), keeping their slot | `10` §0, and the video-derived precedent of the disabled `Excel` tab |
| What do the rail's `⇪ Export / open` and `⊶ Page tree` icons do? | Both **expand the sidebar** | the video shows them without behaviour; there is no matching item in the expanded sidebar to point at |
| The rail's `···` | **Omitted** (not built) | nothing to overflow yet; revisit when something would |
| `SPACE SHORTCUTS` | Renders only when the space has shortcuts; none can exist until the Space tools screens (slice 16a) | an empty heading reads as a bug; the slot is kept in the component |
| Who sees `Space tools`? | Space `ADMIN`s only | all four of its screens (permissions, requirement types, key suggestions, history settings) are `ADMIN` actions in `07` §2.1 |
| What is in `Spaces ▾`? | The five most recently opened spaces, the **current space first**, then *View all spaces* | `10` §2 says "recent spaces, then View all spaces"; the current-first rule keeps the list right even though layout and page render in parallel |
| Where does `/` go? | The last space opened, else a starred one, else the first by name; with no spaces, the space list and its explanation | "a fresh clone reaches a logged-in empty space" (`PLAN.md` slice 0) |
| What does a failed sign-in keep? | The email, not the password | React resets a form after an action; without this a typo costs the user their email too |

### RD-053 — Slice 0 schema delta and database-level invariants
**accepted.** Added to `prisma/schema.prisma`: `User.passwordHash`, `isInstanceAdmin`,
`sidebarCollapsed`; `Session`; `UserSpaceState` (the star and the recent-spaces list); real
relations for `Membership.group` and `GroupMember.user` (group-based permissions need them).
The init migration also carries what the schema language cannot express — each pinned by an
integration test: the `Space.key` format `CHECK` (`01`), lower-case emails, `Membership`
naming exactly one subject with one row per subject per space (partial unique indexes,
because NULLs are distinct in a plain `UNIQUE`), and **invariant R1**'s partial unique index
on live requirements. R2's immutability trigger stays with baselines (slice 13).

The `@@unique([spaceId, userId, groupId])` on `Membership` is replaced by the partial
indexes. The whole draft schema is migrated in `0001_init`; tables for later slices exist
but nothing reads or writes them yet.

### RD-054 — The copy deck is generated from the spec
**accepted. Implements `RD-037`.** `10` §13 is the single source: `pnpm copy:gen` parses its
tables into `src/copy/deck.generated.ts`, and a unit test fails if the committed file differs
from what the spec produces — so a string cannot change without the spec changing. Ids and
`{placeholder}` names are type-checked at the call site (`t("bulk.count", { n })`), and ESLint
rejects literal text in `src/app` and `src/ui` components. New rows added for the shell and
sign-in are in `10` §13.1, marked *(ours)* where the video has no equivalent.

---

## Decisions from slice 1 — documents and the editor (2026-10-09)

The video shows Confluence's editor wrapped around Requirement Yogi. It never shows a
save failing, a page being deleted, an image being uploaded, or what several toolbar
glyphs do. These are **design choices, not reproductions**; where the video does show
something, the GUI follows it (`RD-031`).

### RD-055 — Autosaved drafts, immutable versions, and what "save" means
**accepted.** `10` §5.1 shows autosave states (`Ready to go` → `Saving changes` → `Changes
saved`) *and* an **Update** button that "publishes the version", *and* **Close** that
"returns to view mode, keeping the draft", *and* `Revert to last published`. `PLAN.md`
says "immutable `DocumentVersion` on every save". These fit together only if there are two
kinds of save:

- **Autosave** writes a mutable `DocumentDraft` — one per (document, user), holding title,
  content and the version number it started from (`baseVersionNumber`). It is not history.
- **Update** publishes: it canonicalises the draft's content (`RD-063`), creates the next
  immutable `DocumentVersion` carrying the change note (`What did you change?`), makes it
  current, and deletes the draft. **Every Update creates a version** — that is the sense in
  which "every save creates a version".
- **Close** keeps the draft; opening Edit again resumes it. **Revert to last published**
  deletes it.

*Concurrency* (`10` §5.1: "v1 detects a concurrent save and offers merge or overwrite"):
publishing with a `baseVersionNumber` that is no longer current is refused with
`VERSION_CONFLICT`; the editor then offers **Overwrite** (publish anyway, as a new version
on top) or **Reload latest** (discard the draft, open the current version). **Merge is not
built**: the spec says what the user is offered but not what merging means, and a faithful
merge is the co-editing problem `10` §5.1 itself defers to phase 3. *Cost:* two people
editing one page choose a winner rather than combining work.

### RD-056 — The page tree: titles, creation, moving, deleting, renaming
**accepted.** Rules the specs do not state:

- **Titles are unique per space among live pages, case-insensitively** (partial unique
  index on `lower(title)`), 1–255 characters after trimming, no control characters. URLs use
  the page id, so this is for people — breadcrumbs, search and the tree are unreadable
  with twins.
- **`Create` makes the page immediately**: an empty first version titled `Untitled` (or
  `Untitled 2`, … if taken) at the root of the space, then opens the editor. There is no
  unpublished-page state. A child is created from the tree or the space overview.
- **Moving** reparents and reorders **within one space**. Moving across spaces changes
  requirement identity (`MOVED` status, `RD-007`) and is not built in this slice. A page
  cannot be moved under itself or a descendant (database trigger and use case).
- **Siblings are ordered by a dense `ordinal` 0…n−1**; a move renumbers the affected sibling
  lists.
- **Deleting is soft and takes the subtree.** The page and every descendant get the same
  `deletedAt` and `deletedRootId`; the confirmation names how many pages will go. Restore
  from Trash is slice 16a (`10` §18.3). A deleted page's title is free for reuse.
- **Renaming creates a version** (comment `Renamed from "<old>"`), because titles are part
  of what a version records and an unversioned rename would make history lie.
- **Copy** duplicates one page (not its descendants) as `Copy of <title>`, made unique.

### RD-057 — Editor toolbar: what the unlabelled glyphs are
**accepted.** `10` §5.1 draws the toolbar as glyphs. Where the video's glyph is not
self-explanatory, the reading chosen — revisit against the 0:46 frame:

| Glyph | Read as | Why |
|---|---|---|
| `A▾` | Text colour | colour pickers are `A` with a bar |
| `Aᵃ▾` | More formatting: strikethrough, subscript, superscript, code, clear formatting | `A` plus a small `a` |
| `≔` `⒈` `☑` | Bulleted list, numbered list, task list | |
| `⇤` `⇥` | Outdent, indent | lists lift/sink; paragraphs and headings change indent level 0–6 |
| `⫷` `⫸` `⫶` | Align left, align right, align centre | the glyph order is as drawn; the mapping is a guess |
| `▭` | Info panel | a plain rectangle outline; `Info` is a v1 item of both the `+` menu and `{` suggestions, and no other v1 item is a rectangle. Page layouts appear in no list in `10` |
| `🖼` `🔗` `▦▾` `☺` | Insert image/file, link, table (with a size grid), emoji | |
| `+ ▾` | The Insert More Content menu, `10` §5.5 | |
| `↶` `↷` | Undo, redo | |
| `🔍` | Find and replace in the page | Ctrl+F is claimed by the browser's find unless the editor is focused |
| `?` | Keyboard shortcuts | |

Row 2 (only in a table): `Responsive ▾`/`Fixed width ▾` is the table width mode; `hdr-row`,
`hdr-col` toggle header row/column; `num` toggles a numbered first column (a CSS counter,
nothing stored per row); `fill ▾` sets the cell background.

### RD-058 — Files, images and attachments
**accepted.** `Files and images` is a v1 insert item (`10` §5.5) and the byline has a 📎
attachments icon (`10` §4.1), but nothing says where bytes live or what is allowed.

- Bytes are stored **in the database**, content-addressed by SHA-256, up to **10 MiB** each.
  Baseline freeze (`RD-012`) can then copy an image by hash, and a past version always
  finds its image.
- **Deleting an attachment hides it; it does not remove the bytes.** Old versions keep
  rendering their images.
- **Images**: PNG, JPEG, GIF and WebP only, shown inline. **SVG is refused** (it can carry
  script). **Other files** are listed under the page's attachments and download only
  (`Content-Disposition: attachment`, `application/octet-stream`).
- **An image node may only reference an attachment on the same page.** External image URLs
  are refused in v1: they are tracking pixels, they break freeze-time materialisation, and
  fetching them server-side is an SSRF surface. Pasting HTML with a remote `<img>` keeps the
  text and drops the image.
- Attachment URLs are `/api/v1/attachments/{id}/{filename}`; every read checks space `VIEW`
  on the page, and responses carry `X-Content-Type-Options: nosniff`.

### RD-059 — The page view's menus: what ships and what holds a slot
**accepted. Extends `10` §4.1.** The `···` menu lists, in the video's order: Attachments ·
Page History · Restrictions · People who can view · Page information · View in Hierarchy ·
Export to Word · Reqforge · Copy · Move · Delete.

| Item | This slice |
|---|---|
| Attachments, Page History, Page information, Copy, Move, Delete | built |
| View in Hierarchy | built: opens the space overview with the page highlighted in the tree |
| Restrictions, People who can view, and the 🔓 byline icon | drawn, inert — the dialog and its effect are slice 16 |
| Reqforge and the ⛹ byline icon (`10` §4.4) | drawn, inert — its items need the indexer and later tabs (slices 2–14) |
| Export to Word | drawn, inert — no slice in `PLAN.md` builds it; it is backlog, listed so nobody designs it out |

Move is within the space (`RD-056`). `Share` is *copy link* only: sharing with a user needs
notification delivery (`RD-061`).

### RD-060 — Page history: restore, delete, compare
**accepted. Extends `10` §23.**

- **Restore** creates a **new** version whose title and content equal the old one's, with
  the comment `Restored from v. N`. It never moves the current pointer back, so history
  stays append-only. Needs space `EDIT`.
- **Delete** removes one non-current, non-pinned version. The current version cannot be
  deleted (foreign key), a pinned one cannot (trigger, invariant D1), and the button is
  disabled with *"Pinned by baseline N"* for the latter. Needs space `ADMIN`: it is the one
  destructive history action, and `07` §2.1 gives history settings to `ADMIN`.
- **Compare selected versions** takes exactly two. The spec does not say what it shows, so:
  both versions side by side and read-only, with changed **top-level blocks** highlighted
  (added, removed, changed). Block identity is canonical-JSON equality, so the comparison is
  deterministic and cannot disagree with what is stored.
- A past version is viewed read-only at `?version=N`, with a banner linking back to current.

### RD-061 — Watching, Save for later, Share, Notify watchers
**accepted.** `Watching` is on by default for a page's creator; both it and `Save for later`
are per-user toggles with their own tables. `Notify watchers` (checked by default) is sent
with the publish request and recorded on that publish's audit event together with the
number of watchers it applies to. **No email is sent**: delivery needs transport
configuration and a notifications slice, and `RD-035` already places the bell in a later
slice. `Share` is copy-link only (`RD-059`). *Cost:* ticking `Notify watchers` has no
visible effect yet; the checkbox and the data are in place for when delivery ships.

### RD-062 — Presence
**accepted.** The editor's presence avatars (`10` §5.1) show who else has the page open. An
open editor sends a heartbeat every **15 s**; a user counts as present for **45 s** after
the last one, and a user is never shown to themselves. State is a table, not process memory,
so it works with more than one server. The view page does not report presence.

### RD-063 — Content limits and canonical form
**accepted.** What the server will store:

- Content is ProseMirror JSON that **validates against the shared schema** (`03` §1.4) —
  the same schema the editor builds from, imported headlessly. A document the server stores
  is always one the editor can open.
- It is stored **canonicalised**: re-serialised through the schema, so unknown attributes
  are dropped and key order is fixed. This is what makes the indexer's determinism (`I1`)
  hold on stored content and block comparison (`RD-060`) well-defined.
- At most **5 MiB** serialised, nesting depth at most **64**. Title 1–255 characters, change
  note at most 500.
- Link targets may use `http`, `https`, `mailto`, `tel`, or be same-site paths starting with
  `/`; `javascript:`, `data:`, `vbscript:` and anything else are refused. Image sources are
  attachments only (`RD-058`).

### RD-064 — Page API conventions
**accepted. Extends `08` §1.** Slice 1 ships the pages endpoints of `08` §3 early, because
the editor must autosave and publish bodies larger than a server action's 1 MB default.
They authenticate with the **session cookie only** (API tokens arrive in slice 17). Because
a cookie is ambient, every state-changing request must carry an `Origin` that matches the
host or is refused (`ORIGIN_MISMATCH`), on top of `SameSite=Lax`. Errors are RFC 9457
`application/problem+json` with a stable `code`. Unauthenticated API requests get `401`,
never a redirect to the sign-in page. A space or page the caller cannot see is `404`
(`RD-051`). The OpenAPI document is still slice 17's.
