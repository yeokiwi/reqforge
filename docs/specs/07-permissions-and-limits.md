# 07 — Permissions, tenancy and limits

## 1. Why this is its own spec

Requirement Yogi inherits Confluence's permissions and **ignores page-level
restrictions**: marking a table row as a requirement exports its text to everyone with
space-view permission (research §6.7).

This is not an inference from a limitations page. The vendor's own screencast puts it
on a full-screen title card — **"Requirements are visible to anyone on the space"** —
then demonstrates it: a page is set to "Viewing and editing restricted" with
`Everyone: Has no access`, and its requirement `BR-01` still appears, with its full
description, in the Requirements search screen (video §7).

For a tool whose entire purpose is holding the authoritative text of a specification,
in a regulated or defence context, that is disqualifying. We do not carry it forward.

## 2. Model

Subjects: `User`, `Group`. Objects: `Space`, `Document`, `SavedMatrix`, `Baseline`.

### 2.1 Space permissions

| Permission | Grants |
|---|---|
| `VIEW` | see the space, its documents (subject to §2.2), requirements, search, matrices |
| `EDIT` | create and edit documents, edit external property values, run a type's validation, reset key sequences |
| `EXPORT` | dependency matrix, coverage, xlsx/diff exports, bulk operations |
| `ADMIN` | requirement types, key locking, baselines, history settings, permissions |

`EXPORT` is deliberately separate from `VIEW`, exactly as RY does, because those screens
are the expensive ones (research §4.3).

### 2.4 Action permissions configured in Administration

Three settings on Administration → Options (`10` §19.1), with RY's wording and defaults
(videos-2 §4.6). The first two share one rule, quoted: *"By default, only space
administrators can use this feature. If a group is present, the user has to either be
space admin, either be able to both edit the space and be in this group."*

| Setting | Default | Allowed when |
|---|---|---|
| **Requirements rename** | empty | space `ADMIN`, or (space `EDIT` **and** member of a listed group) |
| **Baseline deletion** | empty | space `ADMIN`, or (space `EDIT` **and** member of a listed group) |
| **Export** — *Allow export for anyone who can view requirements* | **ticked** | ticked: anyone with `VIEW`; unticked: only holders of `EXPORT` |

The export setting governs only the CPU-heavy Excel/CSV export jobs. RY's note applies
verbatim: *"Anyone who can view requirements can always export them, with or without this
option, using the REST API."* — viewing is reading, and the API is a read. Restrictions
(§2.2) still filter what any export contains.

Other actions, for completeness:

| Action | Needs |
|---|---|
| Create, edit, delete key suggestions; change key settings | space `ADMIN` |
| Create an external property definition | space `ADMIN` (research §2.6) |
| Change a property's type, delete a definition | instance administrator |
| Reindex a space | space `ADMIN` |
| Reindex a page (byline panel) | space `EDIT` |
| Create or refreeze a baseline | space `EDIT` |
| See the Queue screen | instance administrator; every user sees their own **Personal queue** |

### 2.2 Document restrictions — the divergence

A page carries one of the three restriction modes shown in the Restrictions dialog
(`10` §10), with an entry list of users and groups:

| Mode | Who can view | Who can edit |
|---|---|---|
| **No restrictions** | anyone with space `VIEW` | anyone with space `EDIT` |
| **Editing restricted** | anyone with space `VIEW` | listed entries with `Can view and edit` |
| **Viewing and editing restricted** | listed entries only (`Can view` or `Can view and edit`); `Everyone` shows `Has no access` | listed entries with `Can view and edit` |

Restrictions narrow space permissions; they never grant beyond them.

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

### 2.3 Classification labels

Spaces and documents may carry a classification label (free text configured per
installation, e.g. `Official (Closed)`). Labels are:

- displayed in the document header, on every exported file's header/footer, and in the
  xlsx export's first sheet;
- inherited by requirements and by any baseline that includes them;
- **propagated upward**: a document's effective label is the highest of its own and any
  label on content it embeds.

Labels do not by themselves enforce access — restrictions do — but every export carries
the label of the highest-classified content it contains.

## 3. Isolation

`Space.isolated` (research §6.6) refuses cross-space search, cross-space requirement
links and cross-space REST scoping for that space. An isolated space's requirements never
appear in another space's picker.

## 4. Limits

Configured per installation with per-space overrides. Defaults are RY's documented
numbers where they exist, because they were derived from real deployments.

| Limit | Default | Source |
|---|---|---|
| **Global limit** — requirements treated together in one operation (a query result being processed, a baseline, an export, a bulk action) | 12,000 | RY: *"Maximum number of requirements that can be treated together at any time"* (videos-2 §4.6). It is **not** a cap on how many requirements a space may hold |
| Requirements per baseline | the global limit | RY |
| Requirements per document | 400 hard, 150 warning | RY |
| Diff rows (interactive) | 600 | RY |
| Search page size | 30 | RY (video §8) |
| Matrix page size | 100 default, 600 max | RY |
| Key length | 200 characters after NFC | ours (`03` §4.1) |
| Inline transform occurrences without confirmation | 200 | ours (`03` §6.3) |
| Dependency matrix web cells | 40,000 | RY |
| Traversal depth (`->`) | 4 | ours (`02` §5.1) |
| Rules per requirement type | 40 | ours |
| Types applying to one document | 20 | RY |
| Requirements per Excel import | 4,000 | RY — *"Max 4000 requirements per import"* (videos-2 §3.2), settling the docs' 2,000-vs-12,000 conflict |
| Finished jobs retained in the queue | 20,000 | RY (videos-2 §4.9) |
| Recently viewed saved views per user | 8 | ours (`10` §9.5) |
| Query history per user | 10 | ours (`10` §9.2) |

Exceeding a hard limit is an error with the limit named in the message. Exceeding a
warning threshold is a diagnostic, not a block.

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

## 6. Auditability

Every state-changing operation writes an audit row: actor, at, object, operation,
parameters. Audit rows are append-only and are never pruned by the history retention
policy. Freeze, refreeze, rename, restriction change, permission change and export are
the operations an auditor will ask about, and each must be reconstructable from the
audit log alone.
