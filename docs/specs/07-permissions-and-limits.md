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
| `ADMIN` | requirement types, key locking, baselines, history settings, permissions |

`EXPORT` is deliberately separate from `VIEW`, exactly as RY does, because those screens
are the expensive ones (research §4.3).

### 2.2 Document restrictions — the divergence

A document may carry a restriction: `inherit` (default), or an explicit allow-list of
users and groups for `view` and for `edit`.

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
| Requirements per space | 12,000 | RY global limit (research §6.7) |
| Requirements per baseline | 12,000 | RY |
| Requirements per document | 400 hard, 150 warning | RY |
| Diff rows (interactive) | 600 | RY |
| Matrix page size | 100 default, 600 max | RY |
| Dependency matrix web cells | 40,000 | RY |
| Dependency matrix export axis | 5,000 | RY's tested size (research §4.3) |
| Traversal depth (`->`) | 4 | ours (`02` §5.1) |
| Rules per requirement type | 40 | ours |
| Types applying to one document | 20 | RY |
| Import rows per file | 5,000 | ours — RY's docs conflict (2,000 vs 12,000) |

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
