# 03 — Authoring and indexing

This is the part with no Requirement Yogi equivalent to copy, because RY delegates
authoring to Confluence. It is therefore the highest-risk area of the build and the one
most worth over-specifying.

## 1. The document model

Documents are ProseMirror JSON. The schema is standard rich text (headings, paragraphs,
lists, tables, code, images, links) plus three custom nodes.

### 1.1 `requirement` (inline node)

The marker that declares a requirement. Attributes:

| Attribute | Meaning |
|---|---|
| `key` | the requirement key, e.g. `FN-001` |
| `typeId` | optional requirement type |
| `uid` | stable random id, survives key renames — used for anchoring |

Rendered inline as a lozenge. The **scope** of the requirement — the text that becomes
its title and properties — is determined by placement (§2).

### 1.2 `requirementLink` (inline node)

A reference to an existing requirement. Attributes:

| Attribute | Meaning |
|---|---|
| `spaceKey`, `key` | target |
| `baselineNumber` | optional pin to a baseline of the target (research §4.1) |
| `displayProperty` | optional property of the target to render live |

Inside a requirement's scope it becomes a **dependency**; elsewhere it is a plain
citation recorded as a `DocumentLink`. The relationship comes from the column (or row)
header holding the link, overridden by `propertyConfig.relationship`, and defaults to
`Dependency` in a paragraph (research §4.1). A cell holding only links is a relationship
column and produces no property — see `RD-029`, which also covers demoted markers and the
retry of unresolved links.

### 1.3 `propertyConfig` (block node, lives in a table header cell)

Reqforge's equivalent of RY's "RY Properties" macro. Attributes:

| Attribute | Meaning |
|---|---|
| `name` | the property name this column produces |
| `isTitle` | this column supplies the requirement title |
| `ignored` | column is not indexed |
| `relationship` | overrides the relationship name for links in this column |

Default when absent: the column header's plain text is the property name, and the first
non-ignored column is the title (research §2.5).

## 2. Scope rules — what becomes a requirement

Three layouts, exactly as RY supports (research §2.1):

| Layout | Detection | Scope | Properties | Relationship name |
|---|---|---|---|---|
| **Horizontal table** | marker in a cell of a table with a header row | the whole **row** | one per column | the column header |
| **Vertical table** | marker in a cell of a table whose *first column* is the header | the whole **column** | one per row | the row header |
| **Paragraph** | marker in a paragraph or list item | the whole **block** | none, unless `propertyConfig` inline | `Dependency` |

**Rule S1.** One requirement per scope. A second `requirement` node in the same scope is
an **error**, surfaced in the editor, and the second marker is indexed as a link instead.

**Rule S2.** Within a document, the **first** occurrence of a key is the definition;
later occurrences of the same key become links to it — RY's documented duplicate
behaviour (research §6.1), applied uniformly rather than only on Word paste.

**Rule S3.** A key defined in two different documents of the same space is a **conflict**.
The **first** definition keeps the requirement row — invariant R1 permits only one live
row per key — and the second document's marker produces no row. Both documents are
flagged `KEY_CONFLICT`, shown in red in the UI and listed on the Broken Links / Conflicts
screen. We do not silently pick a winner and we hide neither definition. RY's own
behaviour here is "surfaces in bright red for manual resolution" (research §2.2).
See `RD-025`; diagnostics are persisted per document in `IndexDiagnostic`.

**Rule S4.** Table layout is decided by the presence of a header row or header column. A
table with neither produces a **warning** on every requirement in it, matching RY's
"grey first row that is not a real header" warning case (research §2.4), and is read as
horizontal so the row is still the scope.

**Rule S5.** A table with **both** a header row and a header column is horizontal: the
header row wins (`RD-023`).

## 3. The indexer contract

`indexDocumentVersion(version) → IndexResult` in `src/domain/indexer/`. **Pure**: takes
document JSON plus space configuration, returns records. No database access.

```ts
type IndexResult = {
  requirements: IndexedRequirement[];   // title, bodyHtml, bodySearch, anchorPath, typeId
  properties:   IndexedProperty[];      // kind INLINE only
  dependencies: IndexedDependency[];    // childKey -> parent ref + relationship
  links:        IndexedLink[];          // citations, origin=false
  diagnostics:  Diagnostic[];           // errors and warnings, with node positions
};
```

**Contract I1 — determinism.** Same input JSON + same space config ⇒ byte-identical
output. Property-based tested with generated documents.

**Contract I2 — reindex is a full replace, scoped.** Applying an `IndexResult` deletes
and rewrites every `INLINE` property, dependency and non-origin link **for requirements
defined in this document**, and never touches `EXTERNAL` properties, baselined rows, or
requirements defined elsewhere.

**Contract I3 — removal marks, never deletes.** A requirement that disappears from the
document becomes `status = DELETED`, retaining its row, its external properties and
inbound dependencies. This is what makes RY's "broken links" screen and key-sequence
behaviour possible.

**Contract I4 — synchronous excerpts.** Requirement Yogi's reindex only marks rows and
defers text extraction until someone views the page (research §6.5), which breaks
headless pipelines. Reqforge extracts everything during indexing. This is `RD-005`.

### 3.1 `bodySearch` normalisation

In order: strip markup → collapse whitespace → normalise Unicode to NFKC → serialise
list-valued cells as `\x1f`-separated members so `=` can be set membership
(research §3.7, invariant R3).

The column keeps its original case and `~` compiles to `ILIKE`, backed by an index on
`lower("bodySearch")`. There is no `bodySearchCI` column — see `RD-024`, which supersedes
the earlier lowercasing step.

## 4. Keys

### 4.1 Validation

`^[A-Za-z0-9._-]+$`, length 2–64, at least one non-digit, no leading/trailing separator.
Rejects slashes and spaces, as RY does (research §2.2, §6.7). Validated **server-side on
index**, never trusted from the client (research §2.2's devtools warning).

### 4.2 Patterns and suggestion

A `RequirementType` carries a pattern such as `FN-###` where `#` runs are the numeric
part. Suggestion:

1. Find the type whose pattern matches the context (last key used in this document, else
   the space default).
2. Next number = `max(nextSequence, highestExistingNumber + 1)`.
3. `nextSequence` advances on use and **does not rewind on delete** (research §2.3).
4. A "reset sequence" action rewinds it to `highestExistingNumber + 1`, gated on
   `preventReusingDeletedKeys = false` and the edit-space permission.
5. "Existing" depends on that same flag (`RD-026`): with it on, every key the space has
   ever used counts, including `DELETED` ones; with it off, only keys that are not
   `DELETED` count. Keys captured in a baseline always count, under either setting.

### 4.3 Locking

When `locked` is set on a space's types, the editor refuses keys that match no type
pattern, and the indexer records a `KEY_NOT_ALLOWED` diagnostic for any that slip
through.

## 5. Renaming

Mirrors RY's behaviour (research §2.8) with one improvement.

- **Single rename**: dialog, new key, validate, run.
- **Batch rename**: decompose selected keys into common prefix + variable middle +
  common suffix. The user edits the first line; the rest transform live. The preview
  lists at most 50 with a count of the remainder.
- **Propagation**: every `requirement` and `requirementLink` node in every *current*
  document version, every `UnresolvedDependency.targetKey`, and every saved query that
  references the key literally — `SavedMatrix.query`, `SavedSearch.query` and the `report`
  node's `query`, located by the grammar rather than by text search (`RD-052`).
  Dependencies and document links need nothing: they are foreign-key edges, so they follow
  the requirement. Nor do properties, inline or external: a property hangs off
  `requirementId`, never off the key.
- **How a document is rewritten**: the key moves in the document's ProseMirror JSON, a
  **new** `DocumentVersion` is written, and the ordinary index pipeline runs over it, all
  inside the rename's transaction (`RD-050`). This is required, not cosmetic: the indexer
  reconciles by key and marks a vanished key `DELETED`, so a rename that left the document
  saying the old key would resurrect it on that document's next save and delete the
  renamed row.
- **Two-phase key update**: every renamed row goes to a sentinel key and then to its
  target, because the partial unique index on the live key is not deferrable and a batch
  may be a permutation — `FN-1 → FN-2` alongside `FN-2 → FN-3` (`RD-054`).
- **Limits**: at most 2,000 requirements and 1,000 documents per rename (`RD-054`).
- **Permission**: `ADMIN` (`RD-053`), matching RY's "global admin or a granted group".
- **Transactionality**: one job, one database transaction, full rollback on any error —
  RY's "No modification was saved". Cancelling gets the same guarantee, because it rolls
  the same transaction back.
- **Baselined rows are never renamed.** A frozen baseline keeps the key it was frozen
  with; the live requirement carries a `renamedFrom` chain so history resolves. This is
  `RD-007` and is a deliberate divergence: RY rewrites page XHTML, which cannot reach
  frozen snapshots either, but never says so.
  The chain is stored in `RequirementKeyAlias` (`RD-051`); `Requirement.renamedFrom` holds
  only the last hop. Two things read it: the requirement screen, so a link written before
  the rename still lands, and the diff, so a renamed requirement pairs with its own
  snapshot instead of reading as removed on one side and added on the other. The RQL
  compiler resolves the same chain in SQL, which is what keeps `isModified()` and the diff
  agreeing (`RD-047`).
- **History**: one `KEY_RENAMED` row per requirement, and one audit row carrying the whole
  mapping, so spec `07` §6's "reconstructable from the audit log alone" holds for a
  rename.
- **Progress**: job progress with cancel, and an explicit acknowledge step.

## 6. Editor UX requirements

- `Alt+Shift+R` inserts a requirement; on a selected table it inserts one key per row
  (research §2.4/§4.1). Mac: `Option+Shift+R`.
- Typing `{req` opens the same picker. The picker offers "create new key" and "link to
  existing", with cross-space results only when the space is not isolated.
- Inserting a typed key into an **empty** table scaffolds the type's required and
  optional columns; it does nothing once the table has content (research §2.4).
- Validation appears as a byline warning; clicking reveals invalid requirements as red
  pills. Required-property failures are red, optional yellow, formatting issues yellow.
- **Quick fixes** next to each red message add the missing column or dependency.
- Hovering a requirement or link shows the popup: excerpt, properties (external ones
  marked `*`), dependencies both directions, and navigation across all occurrences.

## 7. Diagnostics catalogue

| Code | Severity | Trigger |
|---|---|---|
| `DUPLICATE_MARKER_IN_SCOPE` | error | Rule S1 |
| `KEY_CONFLICT` | error | Rule S3 |
| `KEY_INVALID` | error | §4.1 |
| `KEY_NOT_ALLOWED` | error | §4.3 |
| `MISSING_REQUIRED_PROPERTY` | error | type rule |
| `MISSING_REQUIRED_DEPENDENCY` | error | type rule |
| `MISSING_OPTIONAL_PROPERTY` | warning | type rule |
| `TABLE_HAS_NO_HEADER` | warning | Rule S4 |
| `UNRESOLVED_LINK` | warning | target does not exist |
| `PROPERTY_NAME_NOT_SEARCHABLE` | warning | name contains a space (research §2.5) |
| `IMAGE_IN_REQUIREMENT` | warning | research §5.3 leak 2 — images do not baseline well |
| `PROPERTY_NOT_IN_VALUES` | error | `PROPERTY_IN` rule (`06` §1), `RD-041` |
| `PROPERTY_DOES_NOT_MATCH` | error | `PROPERTY_MATCHES` rule (`06` §1), `RD-041` |

A diagnostic that can be repaired mechanically carries its fix as data (`RD-042`); the
editor turns it into one undoable transaction (`06` §4).
