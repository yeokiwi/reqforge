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
citation recorded as a `DocumentLink`.

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

### 1.4 The standard rich-text schema

One definition, built from TipTap extensions with no DOM (`src/editor/schema`), imported by
the editor, the page renderer and the server's validator, so a stored document is always one
the editor can open (`RD-063`). Requirement nodes (§1.1–1.3) join it in slice 2; adding a
node later never invalidates stored content.

| Node | Kind | Attributes | Content |
|---|---|---|---|
| `doc` | block | | `block+` |
| `paragraph` | block | `textAlign` (`left`/`center`/`right`/`justify`/null), `indent` 0–6 | inline* |
| `heading` | block | `level` 1–6, `textAlign`, `indent` | inline* |
| `blockquote` | block | | `block+` |
| `codeBlock` | block | `language` (string/null) | text* , no marks |
| `horizontalRule` | block | | — |
| `bulletList` / `orderedList` | block | `start` (ordered, default 1) | `listItem+` |
| `listItem` | block | | `paragraph block*` |
| `taskList` / `taskItem` | block | `checked` (item) | `taskItem+` / `paragraph block*` |
| `table` | block | `widthMode` (`responsive`/`fixed`), `numberedColumn` (bool) | `tableRow+` |
| `tableRow` | block | | `(tableCell \| tableHeader)*` — a row may hold no cells: it is what a whole-row merge leaves behind (`RD-065`) |
| `tableHeader` / `tableCell` | block | `colspan`, `rowspan`, `colwidth`, `background` (`#rrggbb`/null) | `block+` |
| `infoPanel` | block | `variant` (`info`/`note`/`success`/`warning`/`error`) | `block+` |
| `tableOfContents` | block atom | `minLevel`, `maxLevel` (1–6) | — |
| `image` | inline atom | `attachmentId`, `src`, `alt`, `title`, `width` | — |
| `status` | inline atom | `text`, `colour` (`grey`/`red`/`yellow`/`green`/`blue`/`purple`) | — |
| `date` | inline atom | `value` (`YYYY-MM-DD`) | — |
| `mention` | inline atom | `userId`, `label` | — |
| `hardBreak`, `text` | inline | | |

Marks: `bold`, `italic`, `underline`, `strike`, `code`, `subscript`, `superscript`,
`link` (`href`), `textStyle` (`color` `#rrggbb`/null).

Rules the schema layer adds beyond structure (`RD-058`, `RD-063`, `RD-068`): `link.href` must
be `http`, `https`, `mailto`, `tel` or start with `/`; an `image` must carry an `attachmentId`
and a `src` of exactly `/api/v1/attachments/{attachmentId}/…`; colours and dates must match
their patterns; **every string must be storable in PostgreSQL `jsonb` — no U+0000 and no
unpaired UTF-16 surrogate**; nesting depth ≤ 64; serialised size ≤ 5 MiB. Attribute ranges and
the finer link and image rules are in `RD-068`.

### 1.5 Canonical form

Before storing a draft or a version the server runs `validateDocumentJson`: it parses the
JSON with the schema, checks it, and re-serialises it with `node.toJSON()`. The result —
unknown attributes dropped, defaults filled in, adjacent identical text marks merged — is
what is stored and what the indexer reads, so indexing is deterministic on stored content
(contract I1) and the history compare (`RD-060`) is well-defined. **Canonical means
canonical in content, not in byte order:** `jsonb` does not preserve object key order, so a
stored document may come back with its keys rearranged. Compare stored content by deep
equality or by `canonicalJson` (sorted keys), never by a raw string against freshly
canonicalised JSON.

## 2. Scope rules — what becomes a requirement

Four layouts. The first three are in the written docs (research §2.1); **headings** are
shown in the screencast (video §5) and are not in the prose docs at all.

| Layout | Detection | Scope | Properties | Relationship name |
|---|---|---|---|---|
| **Horizontal table** | marker in a cell of a table with a header row | the whole **row** | one per column | the column header |
| **Vertical table** | marker in a cell of a table whose *first column* is the header | the whole **column** | one per row | the row header |
| **Paragraph** | marker in a paragraph or list item | the whole **block** | none, unless `propertyConfig` inline | `Dependency` |
| **Heading** | marker in a heading of any level | the **heading text** | none | `Dependency` |

A requirement in a heading takes only the heading's own text as its title — **not the
section beneath it**. The video's example page puts `REQ-H1`, `REQ-H2`, `REQ-2.1` and so
on directly in headings at several levels, and each is an independent requirement. We
additionally record the heading level and the enclosing section path on the requirement
(`headingLevel`, `sectionPath`), because a document outline is free structure that a
requirements tool should not throw away — see `RD-026`.

**Rule S1.** One requirement per scope. A second `requirement` node in the same scope is
an **error**, surfaced in the editor, and the second marker is indexed as a link instead.

**Rule S2.** Within a document, the **first** occurrence of a key is the definition;
later occurrences of the same key become links to it — RY's documented duplicate
behaviour (research §6.1), applied uniformly rather than only on Word paste.

**Rule S3.** A key defined in two different documents of the same space is a **conflict**.
Both rows are kept, both flagged `KEY_CONFLICT`, both shown in red in the UI and listed
on the Broken Links / Conflicts screen. We do not silently pick a winner. RY's own
behaviour here is "surfaces in bright red for manual resolution" (research §2.2).

**Rule S4.** Table layout is decided by the presence of a header row or header column. A
table with neither produces a **warning** on every requirement in it, matching RY's
"grey first row that is not a real header" warning case (research §2.4).

**Rule S5.** Requirements inside **collapsible blocks** — expand sections, panels, info
boxes, layout columns, list items, nested tables — are indexed exactly as if the block
were open. RY's administration video uses a requirement inside an *Expand* macro as its
example of an *indexing problem* that leaves the requirement marked DELETED (videos-2
§4.4). We do not reproduce the problem: the indexer walks the whole document tree, and a
fixture with a requirement in every container type is part of contract I1's test set.

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

In order: strip markup → collapse whitespace → normalise Unicode to NFKC → lowercase for
the `~` path (a separate `bodySearchCI` generated column) → serialise list-valued cells
as `\x1f`-separated members so `=` can be set membership (research §3.7, invariant R3).

## 4. Keys

### 4.1 Validation — permissive, not restrictive

The written docs say keys accept "only letters, numbers, underscore, hyphen and dot".
**The product does not behave that way.** The screencast (video §4) shows, as explicitly
allowed: `REQ-!@#$%%^*()_-002`, `日本語の文字-001`, `حروف عربية-001`, `REQ-004(§2.5)`
and `REQ 005` — punctuation, CJK, Arabic, the section sign, parentheses and an internal
space. The only demonstrated rejection is `REQ/006\`, with the inline message
`"REQ/006\" is not a valid key.`

Teams writing specifications in Japanese, Arabic or with clause numbering such as
`§2.5` are a real constituency, and an ASCII-only key rule locks them out. So Reqforge
is permissive, with narrow, justified exclusions (`RD-023`):

**Accepted**: any Unicode character, normalised to NFC, with these exclusions.

**Rejected** (hard error, `KEY_INVALID`):

| Rejected | Reason |
|---|---|
| `/` and `\` | path separators; RY rejects them too, and they break the `/requirements/{space}/{key}` URL |
| C0/C1 control characters, `U+200B`–`U+200F`, `U+2028`/`U+2029` | invisible characters make two different keys look identical |
| leading or trailing whitespace | invisible, and survives copy-paste into queries |
| length outside 1–200 characters after NFC | |
| a key consisting only of whitespace or punctuation | must contain at least one letter or digit |

**Accepted with a warning** (`KEY_AWKWARD`, non-blocking, shown once in the editor):

| Pattern | Why we warn |
|---|---|
| contains a space | must be quoted in every query: `key = 'REQ 005'` |
| contains `'` or `%` | `'` needs escaping in a query literal; `%` collides with the `~` wildcard — the editor offers the pre-escaped query form in the warning |
| contains characters outside NFC-normalised letters, digits, `.`, `-`, `_` | fine, but worth knowing before it is the key of 400 requirements |
| mixes scripts within one key | a classic homograph trap (`РЕQ-001` with Cyrillic Р and Е) |

Two consequences the implementation must handle rather than assume away:

1. **Case folding is Unicode-aware.** `upperKey` uses full case folding, not
   `toUpperCase()` on ASCII. Turkish dotless ı and German ß are the usual casualties.
2. **Keys are URL-escaped, never URL-inlined raw.** `/requirements/{space}/{key}` uses
   percent-encoding, and the canonical form of a key in an export is the NFC string.

Validation runs **server-side on index** and is never trusted from the client — the
written docs' own devtools warning (research §2.2), confirmed by the video showing
validation as an inline editor message rather than a hard input mask.

### 4.2 Key suggestions

A **key suggestion** is a **prefix, a zero-padded number and a suffix** — `BR-` · `04`
· *(none)*, `SPEC-` · `00255` · *(none)*. That is how RY's own key-suggestion table
models it (videos-2 §4.7), and it replaces the `FN-###` template this section used
before (`RD-042`). The number's **width is its padding**: `007` pads to three digits,
`00255` to five.

Each space has a list of suggestions. They come from three places:

1. **Automatically from the keys in the database.** Every new key whose shape is
   prefix + digits + suffix registers or advances its suggestion. *"Unless suggestions
   are locked and already created, the suggestions will be created from the keys in the
   database."*
2. **Added by a space admin** on the Key suggestions screen (`10` §18.1) — prefix,
   number (pre-filled `001`), suffix, `Add`.
3. **Promoted to a requirement type** by giving it a name (`06` §1).

Offering keys:

1. **Offer the next key of every suggestion in the space, simultaneously.** The picker
   lists `Create BR-08`, `Create FN-12`, `Create TECH-008` together (video §3.1); the
   author picks. Do not guess one from context.
2. Order by proximity: suggestions already used on this page first, then the rest of the
   space.
3. Next key = prefix + `pad(lastNumber + 1, width)` + suffix, where `lastNumber` is the
   suggestion's stored number. The stored number **advances on use and does not rewind
   on delete** (research §2.3).
4. **Deleting a suggestion** removes it; the next key for that prefix is then recomputed
   from the highest existing key — *"If you delete a suggestion, new keys will be based on
   the last sequence in the base."*
5. With **Prevent reusing deleted keys** ticked, the recomputation also counts deleted
   requirements, so a deleted number is never offered again.

**Settings**, per space with a global default, verbatim names and RY's defaults:

| Setting | Default | Effect |
|---|---|---|
| Use global settings | **ticked** | the space inherits the Administration values; the four below are disabled |
| Links across spaces | **ticked** (recommended) | the picker offers other spaces' requirements when linking; pasting a direct link always works |
| Prevent reusing deleted keys | unticked | deleted keys are never suggested again |
| Generate global keys | unticked | generated keys are unique across the instance, not just the space |
| Lock keys | unticked | authors may only use keys from the suggestion table (§4.3) |

### 4.3 Locking

With **Lock keys** ticked, the editor offers only the suggestion table's keys and refuses
any other, and the indexer records a `KEY_NOT_ALLOWED` diagnostic for any that slip
through (pasted content, API uploads).

## 5. Renaming

Mirrors RY's behaviour (research §2.8, videos-2 §4.5) with one improvement. The screen is
`10` §17.

- **Who:** space administrators by default. The Administration *Requirements rename*
  setting lists groups whose members may also rename — **if they can edit the space**
  (`07` §2.4). This replaces the "global admin or configured group" reading of the
  written docs.
- **Entry:** Search tab → select → `Actions` → `Rename`. One key or many, same screen.
- **Decomposition:** each selected key splits into **Prefix · Middle · Suffix**, where
  prefix and suffix are the parts common to every selected key and middle is the varying
  part. The user edits the first row's prefix and suffix; every other row previews live.
  The middle is never edited — renumbering is not renaming.
- **Validation before running:** every resulting key passes §4.1 and is unique in its
  scope, or nothing runs and the clashes are listed.
- **Propagation**: every `requirement` and `requirementLink` node in every *current*
  document version, every dependency row, every external property row, every saved matrix
  query that references the key literally.
- **Transactionality**: one job, one database transaction, full rollback on any error —
  RY's "No modification was saved".
- **Baselined rows are never renamed.** A frozen baseline keeps the key it was frozen
  with; the live requirement carries a `renamedFrom` chain so history resolves. This is
  `RD-007` and is a deliberate divergence: RY rewrites page XHTML, which cannot reach
  frozen snapshots either, but never says so.
- **Progress and result:** the long-running task view (`10` §17.2), ending with
  *"Rename task finished successfully."* and the count line *"Reqforge modified {m}
  macros on {p} pages to rename {r} requirements."*

## 6. Insertion — behaviour

What the user **sees** — every dialog, label, default and chip — is specified in
`10-ui-reference.md` §5–6 and follows the vendor screencast (`RD-031`). This section
holds only the **behaviour** behind those screens. If a rule here seems to need a visual
change, change `10` first.

### 6.1 Three routes, one picker (GUI: `10` §5.3, §6.1)

The video names three routes — **Keyboard shortcut `Alt + Shift + R`**,
**`{requirement`**, and the **Insert More Content Menu** — and all three end in the
same key picker. The picker is the single entry point: a fourth route is added to the
picker, not beside it.

- `Create <key>` lines: one per registered key pattern, the next key of each (§4.2).
- Typing in `Enter requirement key` switches the list to existing requirements to
  **link** to; cross-space results appear only when the space is not isolated.
- Choosing a line commits the macro; `Remove` deletes it; `Esc` leaves the placeholder.

### 6.2 Bulk insert in edit mode (GUI: `10` §6.3)

The dialog has **two variants**, selected by what is highlighted — the video shows both:

| Selection | Variant | The user supplies |
|---|---|---|
| empty cells or lines | **A** | `Prefix and first number`, pre-filled from the next suggested key and zero-padded |
| cells or lines containing text | **B** | a `Mode` — *Use selected text as keys* or *Generate numbers automatically* — and an optional `Prefix` |

Rules:

- **Count is a promise.** The `{n} lines` figure is computed before the dialog opens and
  exactly that many macros are inserted.
- **All or nothing.** In variant B with *Use selected text as keys*, every line is
  validated against §4.1 before anything is inserted. One failure refuses the whole
  operation and lists the offending lines. A half-applied bulk insert is not a state
  anyone can reason about.
- **Prefix is mandatory when the selection contains only numbers** — the dialog's own
  help text says so; enforce it, don't just display it.
- **Padding.** Variant A pre-fills the first number already zero-padded to the
  pattern's width (`008`), so the user keeps the padding by doing nothing; the help text
  reminds them anyway, as shown. Generated numbers keep the width of the first number.
- *Generate numbers automatically* inserts each macro **before** the existing text of
  its line, leaving that text in place.

### 6.3 Inline transform in view mode (GUI: `10` §6.4)

Selecting key-like text in a rendered page opens the inline dialog. This is the "we
pasted a Word document, now make it real" path.

Defaults are part of the behaviour and follow the video:

| Option | Default | Effect |
|---|---|---|
| Make links for every "KEY" on this page. | on, cannot be unchecked | later occurrences on the page become links |
| Make links for every "KEY" in this space. | **on** | occurrences on other pages in the space become links |
| Create similar definitions for all "PREFIX"… | **off** | every regex match on this page becomes a definition |

Rules:

- The selected occurrence becomes the definition — unless Rule S2 says an earlier
  occurrence on the page wins, which it does, as RY documents for its Word-paste flow.
- The regex must match the **complete key**. `Refresh` recounts. Zero matches disables
  the option; more than 200 asks for confirmation.
- The transform runs against rendered text only, never existing macros, so running it
  twice is a no-op.
- One job, one transaction: all pages touched get a new version each, or none do.
- The space-wide option respects restrictions — pages the user cannot edit are skipped
  and listed in the job result, never silently modified.

### 6.4 Templates and validation in the editor

- Inserting a typed key into an **empty** table scaffolds the type's required and
  optional columns; it does nothing once the table has content (research §2.4).
- Validation appears as a byline warning; clicking reveals invalid requirements as red
  pills. Required-property failures are red, optional and formatting issues yellow.
- **Quick fixes** next to each message add the missing column or dependency, each as a
  single undoable transaction.
- Key validation failures appear in the picker exactly as the video shows them
  (`10` §6.2): `"<key>" is not a valid key.` under the field, with `Remove` beside it.

The hover popup is specified in `10-ui-reference.md` §8.

## 7. Diagnostics catalogue

| Code | Severity | Trigger |
|---|---|---|
| `DUPLICATE_MARKER_IN_SCOPE` | error | Rule S1 |
| `KEY_CONFLICT` | error | Rule S3 |
| `KEY_INVALID` | error | §4.1 hard rules |
| `KEY_AWKWARD` | warning | §4.1 soft rules — spaces, `%`, `'`, mixed scripts |
| `KEY_NOT_ALLOWED` | error | §4.3 |
| `MISSING_REQUIRED_PROPERTY` | error | type rule |
| `MISSING_REQUIRED_DEPENDENCY` | error | type rule |
| `MISSING_OPTIONAL_PROPERTY` | warning | type rule |
| `TABLE_HAS_NO_HEADER` | warning | Rule S4 |
| `UNRESOLVED_LINK` | warning | target does not exist |
| `PROPERTY_NAME_NOT_SEARCHABLE` | warning | name contains a space (research §2.5) |
| `IMAGE_IN_REQUIREMENT` | warning | research §5.3 leak 2 — images do not baseline well |
