# Requirement Yogi — screencast evidence

Source: *"How to write software specifications documents in Confluence Data Center with
Requirement Yogi"*, 1080p, 4:00, supplied 2026-10-08. Confluence 8.1.0, RY 4.x,
`sandbox2.requirementyogi.com`.

Method: frames sampled every 2 s and OCR'd; key frames inspected directly. Audio was not
transcribable in this environment, so everything below is **on-screen evidence** —
UI text, dialog copy and slide captions. Timestamps are `m:ss`.

This file outranks `requirement-yogi-dc.md` where the two disagree, because it shows the
running product rather than prose about it. Section 7 lists the contradictions.

---

## 1. What the video covers

Agenda slide at 0:14:

- 3 ways to insert a macro
- 3 ways to bulk create requirements
- Tips about format and permissions

---

## 2. The macro and its popup

### 2.1 Popup anatomy (0:24, inspected at full resolution)

```
┌────────────────────────────────────────────────────────────────┐
│  FN-01   [ORIGINAL DEFINITION]                 Current  < >    │
├────────────────────────────────────────────────────────────────┤
│  Phasellus ex sapien, tincidunt quis tortor ut, pretium …      │
│  Click to expand…                                              │
│                                                                │
│   • Cost: $2700                                                │
│   • Description: <full text>                                   │
│   • Estimate*: 5                                               │
│   • Estimate (Max)*: 10                                        │
│   • Priority: [CRITICAL]        ← rendered lozenge, not text   │
│   • Relates: BR-01                                             │
│   • Suspect*: true                                             │
│                                                                │
│  See also:                                                     │
│   • [PARENT ↗] (relates) BR-01                                 │
│   • [CHILD ↘]  (functional_requirement) TECH-001               │
│   • [CHILD ↘]  (functional_requirement) TECH-002               │
│   • [LINK]     Test session 1                                  │
│   • [LINK]     What is important - Specifications              │
│   • [JIRA]     (implements) SCRUM-1 [TO DO] As an Agile team…  │
│                                                                │
│  Tests:                                                        │
│   • [TESTS] | Success | 1 0 1 0 1 0                            │
└────────────────────────────────────────────────────────────────┘
```

Observations that matter:

- The header carries a **state badge** (`ORIGINAL DEFINITION`) and a **version stepper**
  showing `Current` with `<` / `>`. You can page through baselined versions from the
  popup.
- **Property names are hyperlinks** — clicking one runs the corresponding query.
- **`*` suffix marks an external property** — confirms the written docs.
- Property values keep their **rendered formatting**: `Priority` shows the actual red
  `CRITICAL` lozenge, not the string.
- `Description` appears in the property list as well as in the excerpt above it.
- **An external property is named `Estimate (Max)`** — a space *and* parentheses.
- Long text truncates with **"Click to expand…"**.

### 2.2 The direction rule, confirmed on screen

`FN-01` sits in a table whose `Relates` column contains a link to `BR-01`. Its popup
shows `PARENT ↗ (relates) BR-01`, and `TECH-001` — whose `Functional requirement`
column links to `FN-01` — appears as `CHILD ↘`.

So: **the requirement containing the link is the child; the linked requirement is the
parent.** Invariant P1 is correct, and the UI labels it explicitly with ↗ / ↘ arrows.

### 2.3 Canonical URL (status bar, 0:24)

```
https://<host>/confluence/requirements/TEAM/FN-01
```

→ `/requirements/{SPACE}/{KEY}`.

---

## 3. Three ways to insert a macro (0:44 – 1:10)

1. **Insert menu** — the editor's `+` → "Other macros", listed alongside Files and
   images, Link, Horizontal rule, Task list, Date, Symbol, Jira Issue/Filter, Status,
   Table of Contents.
2. **Keyboard shortcut** — `Alt + Shift + R`.
3. **Autocomplete** — typing `{` opens "Macro suggestions" (Info, Status, Gallery,
   Table of Contents, Requirement…).

### 3.1 Key suggestion offers every pattern at once (0:54, 1:00, 1:08)

The inserted macro's picker shows, simultaneously:

```
▸ Create BR-08
▸ Create FN-12
▸ Create TECH-008
```

and after `BR-08` is used, the next invocation offers `Create BR-09`, then `BR-10`.

**This is not "pick the pattern matching the context".** The picker offers the next key
for *every* registered pattern in the space, and the author chooses. The sequence for a
pattern advances only when a key from that pattern is taken.

---

## 4. Format and permitted characters (1:24 – 1:44) — the big correction

Two slides, a green "allowed" card and a red "forbidden" card, inspected at full
resolution.

### Allowed — "Most keyboards and language symbols"

| Example | Demonstrates |
|---|---|
| `REQ-001` | the baseline case |
| `REQ-!@#$%%^*()_-002` | punctuation and shell-hostile symbols |
| `日本語の文字-001` | CJK |
| `حروف عربية-001` | Arabic, right-to-left |
| `REQ-004(§2.5)` | parentheses and `§` — captioned "Paragraphs: §" |
| `REQ 005` | **a blank space inside the key** — captioned "Blank spaces" |

### Forbidden — "no / and \"

A macro-edit field containing `REQ/006\` with the inline error:

```
"REQ/006\" is not a valid key.
```

and a **Remove** button beside the field.

**So the real rule is: any character except `/` and `\`.** The written documentation's
"Only letters, numbers, underscore, hyphen and dot are accepted" is wrong, or describes
only the *suggestion pattern* grammar. The limitations page's "No slashes in keys" is
the accurate statement.

Interesting corroboration: the inline dialog's default regex (section 6) is
`REQ-[A-Za-z0-9._-]+`, i.e. the conservative set is RY's *default suggestion*, not its
*validation rule*.

### Naming guidance (1:14)

> "Put the type of document in the prefix of the key"

---

## 5. Requirements in paragraphs and titles (1:46 – 2:04)

A "Format" page demonstrating requirements inside **headings**:

| Element | Key |
|---|---|
| Heading 1 | `REQ-H1` |
| Heading 2 | `REQ-H2` |
| Subheading 1.1 | `REQ-H3` |
| Subheading 1.2 | `REQ-1.2` |
| Heading 2.2 | `REQ-H2.2` |
| Subheading 2.1 | `REQ-2.1` |
| Subheading 2.2 | `REQ-2.2` |

Captions: *"You can put requirements in paragraphs and titles"* and *"Each column of a
table [is] the name of the relationship"*.

**Headings are a supported scope.** The written docs only enumerate horizontal tables,
vertical tables and paragraphs.

---

## 6. Three ways to bulk create (2:06 – 3:18)

### 6.1 Edit mode — the bulk insert dialog (inspected at 2:30)

Triggered by selecting several cells or lines and pressing `Alt + Shift + R`:

```
┌─ Insert the Requirement macro ─────────────────────────────────┐
│  This will create one macro for each of the 3 lines.           │
│                                                                │
│  Mode   ◉ Use selected text as keys                            │
│           Requires that the selected text already contains     │
│           numbered requirements with a prefix.                 │
│         ○ Generate numbers automatically                       │
│           The macros will be inserted before the selection.    │
│                                                                │
│  Prefix [________]  FN-12                                      │
│         (Optional) A prefix to insert before the requirement   │
│         numbers. It is mandatory when the selection only       │
│         contains numbers.                                      │
│                                                                │
│  Requirement Yogi (Alt + Shift + R)        [Insert]  Cancel    │
└────────────────────────────────────────────────────────────────┘
```

An earlier variant of the dialog (2:16) carries the guidance:

> "(Mandatory) A prefix, and the first number of your requirements. Don't forget to pad
> with leading 0s, so requirements are sorted when in alphabetical order."

Two of the three bulk routes are the two radio modes:

- **Generate the macro from empty cells** — select empty cells, shortcut, numbers
  generated. Produced `TECH-008` … `TECH-013` from six empty rows.
- **Select already existing numbers and replace them** — select cells that already hold
  numbers, shortcut, prefix supplied. Produced `FN-12`, `FN-13`, `FN-14`.

### 6.2 View mode — the inline dialog (inspected at 3:02)

Selecting an existing key in view mode:

```
┌────────────────────────────────────────────────────────────────┐
│  Type*                                                         │
│  [ Inline                                            ▾ ]       │
│  Refresh                                                       │
│  "Inline" is the same as editing the page and inserting with   │
│  [ Alt + Shift + R ].                                          │
│                                                                │
│  ☑ Make links for every "REQ-567" on this page.                │
│  ☑ Make links for every "REQ-567" in this space.               │
│  ☑ Create similar definitions for all                          │
│     [ REQ-[A-Za-z0-9._-]+ ] on this page (about 2 other        │
│     occurrences – The pattern must be a regex of the complete  │
│     key, see regex documentation here).                        │
│                                                                │
│  [Create]  Cancel                                              │
└────────────────────────────────────────────────────────────────┘
```

Notes:

- The three options are **independent checkboxes**, not alternatives.
- Scope is **page or space** — the written docs mention only the page.
- The regex is **editable**, must match the **complete key**, and the dialog shows a
  live **occurrence count** ("about 2 other occurrences").
- `Type` is a dropdown, so inline is one of several insertion modes.

---

## 7. Permissions — stated and demonstrated (3:22 – 3:38)

Full-screen caption: **"Requirements are visible to anyone on the space"**.

The demo then opens Confluence's Restrictions dialog —

- No restrictions — Everyone can view and edit
- Editing restricted — Everyone can view, only some can edit
- **Viewing and editing restricted — Only some can view or edit**

— sets "Viewing and editing restricted" with `Everyone: Has no access` and
`admin: Can view and edit`, applies it, and then shows the restricted page's
requirement `BR-01` still listed in full, with its description, in the Requirements
search screen.

This is not an inferred limitation. The product **states it as expected behaviour and
demonstrates it**. It is the strongest possible support for `RD-017`.

---

## 8. The Requirements screen (3:38, inspected at full resolution)

Tabs, left to right:

```
Search | Coverage | Dependencies | Traceability | Baselines | Diff | Estimates | Excel
```

plus a gear (settings) and a help icon at the right.

Below them:

- Query input, a search button, and a **Filters** dropdown.
- Hint line: **`[ Ctrl + Space ] for help, or lookup the search syntax.`**
- **A natural-language echo of the effective query**, including injected defaults:
  > *Requirements - all of them and in space 'TEAM' and with status 'ACTIVE'*
- Result count: `80 requirements.`
- Pager line:
  `Previous – 1-30 of 80 results – Next – Show all versions – Export to Excel – CSV – Cross-space search`
  → default page size **30**; **both Excel and CSV** export; a "Show all versions"
  toggle; a "Cross-space search" switch.
- Results table: selection checkbox, an **Actions** dropdown for bulk operations,
  then columns **Key | Description | Links**.

### 8.1 The Links column badge taxonomy

| Badge | Meaning |
|---|---|
| `ORIGINAL` (green) | the document where the requirement is defined |
| `LINK` (amber) | a document that cites it |
| `PARENT ↗` (dark) | dependency, this requirement → its parent, relationship in parens |
| `CHILD ↘` (dark) | dependency, this requirement → its child |
| `JIRA` (blue) | linked issue, with relationship and issue status |
| `TESTS` | test results with per-status counts |

### 8.2 Saved matrices sidebar

Heading **"TRACEABILITY MATRIXES"**, with collapsible groups:

- **Recently viewed** — Cascade Matrix, Xray status bars for TE…, Components Core
  Stat…, Components UI Status, BR requirements Trace…, FN requirements Trace…,
  TECH requirements Tr…
- **Shared by others** — Key Traceability
- **View all**

So saved matrices have an owner, a sharing model, and a recency list.

---

## 9. Smaller details worth keeping

- Dependency cells in a table render as chevroned lozenges, comma-separated when there
  are several: `› FN-09 , › FN-06`.
- A link macro can display a property of its target; in the editor it reads
  `Requirement | Link | FN-01 | @Priority`.
- In the editor, macros render as `⌁ Requirement | BR-08` for a definition and
  `⌁ Requirement | Link | FN-06` for a reference.
- The page byline area shows live save state: "Ready to go" → "Saving changes" →
  "Changes saved", alongside "What did you change?", "Notify watchers", Update, Close.
- A table used for requirements had the columns
  `Requirement | Description | Component | Functional requirement`, with the last column
  holding link macros — the column header being the relationship name.
- The tab is labelled **Estimates**, not "External Properties", in this build.

---

## 10a. Additional GUI captures (second pass, 2026-10-08)

Thirteen more frames inspected at full resolution to support `10-ui-reference.md`.

### Frame index

If the video is placed at `docs/research/ry-screencast.mp4`, any frame can be pulled
with `ffmpeg -ss <t> -i docs/research/ry-screencast.mp4 -frames:v 1 out.png`.

| t | Screen |
|---|---|
| 0:18 | Page view — chrome, byline, requirement table |
| 0:24 | Popup on `FN-01` (functional requirement) |
| 0:36 | Popup on `BR-01`, scrolled — See also, Tests |
| 0:46 | Editor — toolbar, macro chips, footer save state |
| 0:54 | Key picker in an empty cell |
| 0:58 | `{` autocomplete — Macro suggestions |
| 1:06 | `+` Insert more content menu |
| 1:24–1:44 | Key format slides (allowed / forbidden) |
| 1:46 | Page with requirements in headings and paragraphs; expanded space sidebar |
| 2:06 | Editor — link macro chips stacked in a cell |
| 2:16 | Bulk insert dialog — **empty-cell variant** |
| 2:30 | Bulk insert dialog — **existing-text variant** |
| 2:40 | Inline view-mode dialog — **default state** |
| 3:02 | Inline view-mode dialog — regex expanded |
| 3:24 | Page view with expanded sidebar |
| 3:28 | Restrictions dialog — mode dropdown open |
| 3:30 | Restrictions dialog — viewing and editing restricted |
| 3:38 | Requirements screen — Search tab |

### Global chrome (every screen)

Top bar, dark blue: app-switcher grid · product logo and name · `Spaces ▾` · `People` ·
**`Create`** (bright blue filled button) · `···` — then, right-aligned, a `Search` field,
help `?`, settings gear, notifications, avatar.

### Space sidebar

Two states. **Collapsed** to an icon rail: space logo, Pages, Blog, Requirements, an
export/open icon, a page-tree icon; settings gear and `»` at the bottom. **Expanded**:

```
[logo] Team                         ★
  ▤ Pages            ← selected item has a grey fill
  ❞ Blog
  ⛹ Requirements
SPACE SHORTCUTS
  ⧉ Requirement Yogi -…
  ⧉ Requirement Docu…
PAGE TREE
  ▾ Specifications
      • Page Heading       ← current page in bold
      • Test session 1
      › Test session 1a
  › Team
⚙ Space tools                         «
```

On the Requirements screen, `PAGE TREE` is replaced by `TRACEABILITY MATRIXES` with
`Recently viewed`, `Shared by others` and `View all` (see §8.2).

### Page view

- Breadcrumb `Pages / Specifications`, followed by three byline icons: **restrictions**
  (padlock), **attachments** (paperclip), **requirements** (the product icon).
- Right-aligned page actions: `✎ Edit` · `☆ Save for later` · `◉ Watching` ·
  `⇪ Share` · `···`.
- Title, then `Created by admin, last modified 6 minutes ago`.
- Sections are `h2` headings followed by tables with a grey header row.
- **Requirement definitions render as key pills** — light grey-lavender fill, blue key
  text, no icon.
- **Requirement links render as pills with a leading chevron** — `› FN-02` — inline in
  running text as well as in cells; several in one cell are comma-separated.
- **Heading requirements** render as the heading text followed by the key pill on the
  same line: `Heading 1  [REQ-H1]`.
- Footer: `👍 Like` · `Be the first to like this` · right: `No labels 🏷` · then a
  `Write a comment…` box with the user's avatar.
- Some header cells read `aDescription`, `aOwner` — a small glyph rendered before the
  column name, also carried into popup property names. Unexplained; most likely the
  property-configuration macro's icon. Not reproduced.

### Popup — scroll and tests

The popup has a fixed maximum height and **scrolls internally** (visible scrollbar at
0:36). JIRA entries show the issue's status lozenge (`TO DO`) between key and summary.
The Tests line reads `[TESTS] | ✅ Success | ✅ | ✅ | ✅ | ✅` — the latest result
named, followed by the run history as icons.

### Editor

```
Paragraph ▾ │ B I U │ A▾ Aᵃ▾ │ ≔ ⒈ ☑ │ ⇤ ⇥ │ ⫷ ⫸ ⫶ │ ▭ │ 🖼 🔗 ▦▾ ☺ │ + ▾ │ ↶ ↷        🔍 ?
Responsive ▾ │ row↑ row↓ ✕row │ col← col→ ✕col │ merge split │ hdr-row hdr-col … │ fill▾ │ ✕table
```

- The second row appears **only while the caret is in a table**; its first control is a
  width mode, `Responsive ▾` or `Fixed width ▾`.
- Breadcrumb `Team / Pages / Specifications` with label and restriction icons sits under
  the toolbar; the title is editable in place.
- Collaborator presence avatars top right with a `+` invite button.
- **Macros render as grey chips**: `[⛹ Requirement | BR-01]` for a definition,
  `[⛹ Requirement | Link | FN-06]` for a link, `[⛹ Requirement | Link | FN-01 | @Priority,]`
  for a link displaying a property. Several link chips in one cell **stack vertically**.
- Footer bar: save state (`Ready to go` → `Saving changes` → `Changes saved`) ·
  `What did you change?` field · `☑ Notify watchers` · **`Update`** (blue) · `Close` ·
  `···`.

### Key picker (0:54)

Pressing the shortcut in an empty cell inserts a greyed placeholder chip
`[⛹ Requirement]` and opens a popover directly under it:

```
[Remove]  [ Enter requirement key        ]   ← focused, blue outline
  • Create BR-08
  • Create FN-12
  • Create TECH-008
```

### `{` autocomplete (0:58)

```
Macro suggestions
  ⓘ Info
  ═ Status
  ▦ Gallery
  ☰ Table of Contents
  ⛹ Requirement
  ··· Open macro browser
```

The slide names this route **`{requirement`**.

### Insert more content menu (1:06)

`+ ▾` opens: Files and images · Link · Markup · Horizontal rule · Task list · Date ·
Symbol · User mention · Jira Issue/Filter · Info · Status · Gallery · Table of Contents ·
**Requirement** · — · Other macros. The slide names this route **"Insert More Content
Menu"**.

### Bulk insert — two variants

The dialog's body depends on what was selected.

**Empty cells selected (2:16):**

```
Insert the Requirement macro                                    ✕
────────────────────────────────────────────────────────────────
This will create one macro for each of the 6 lines.

Prefix and first number   [TECH-        ] [008  ]
                          (Mandatory) A prefix, and the first number of your
                          requirements. Don't forget to pad with leading 0s, so
                          requirements are sorted when in alphabetical order.
────────────────────────────────────────────────────────────────
Requirement Yogi (Alt + Shift + R)                 [Insert]  Cancel
```

Both fields are **pre-filled with the next suggested key**, split into prefix and
zero-padded number. No mode radio.

**Cells with existing text selected (2:30):** the mode radio described in §6.1 —
`Use selected text as keys` / `Generate numbers automatically` — and an optional
`Prefix` field. No first-number field.

### Inline dialog — default state (2:40)

The selected key is highlighted in the page. Defaults:

| Control | Default |
|---|---|
| `Type*` | `Inline` |
| Make links for every "REQ-567" on this page. | **checked and disabled** — always applies |
| Make links for every "REQ-567" in this space. | **checked** |
| Create similar definitions for all "REQ-"✎ on this page (about 2 other occurrences). | **unchecked** |

The third option shows only the key's prefix in quotes, followed by a **pencil icon**.
Clicking the pencil swaps it for the editable regex field with the longer help text
seen at 3:02. Buttons: `Create` (grey) · `Cancel` (link style).

### Restrictions dialog (3:28, 3:30)

```
Restrictions                                                 Help
────────────────────────────────────────────────────────────────
[🔓 No restrictions ▾]   Everyone can view and edit this page.
   ┌──────────────────────────────────────────────┐
   │ 🔓 No restrictions                           │
   │    Everyone can view and edit                │
   │ 🔓 Editing restricted                        │
   │    Everyone can view, only some can edit     │
   │ 🔒 Viewing and editing restricted   (red)    │
   │    Only some can view or edit                │
   └──────────────────────────────────────────────┘
[illustration]  Who can see this?
                Right now everyone can view and edit this page if they've got
                the right space permissions. Use the dropdown above to restrict
                this page to only some people.
                Learn more about restrictions
────────────────────────────────────────────────────────────────
                                                  [Apply]  Cancel
```

With **Viewing and editing restricted** selected:

```
[🔒 Viewing and editing restricted ▾]   Only some people can view or edit.
[ Type a user name or group            ] [Can view and edit ▾]  [Add]
  👥 Everyone                              Has no access
  👤 admin (admin)                         Can view and edit
```

`Apply` is disabled until something changes.

### Sampled colour roles

From compressed 1080p video, so approximate — a starting point for design tokens, not a
specification of exact values.

| Role | Sample |
|---|---|
| Top bar background | `#093E9B` |
| Create button | `#0D5BFD` |
| Primary button (Update, Insert, search) | `#0B48B1` |
| Table header row | `#F0F1F3` |
| Sidebar background | `#F2F0F3` |
| Sidebar selected item | `#D9DADE` |
| Key pill background | `#EDEDF2` |
| Macro chip (editor) | `#E9E9E9` |
| `ORIGINAL` badge | `#198B5A` |
| `PARENT` badge | `#444964` |
| `CHILD` badge | `#626878` |
| `LINK` badge | `#DD8A34` |
| `JIRA` badge | `#5A4AA3` |
| Status lozenge — critical | `#A11911` |
| Status lozenge — medium | `#EE841C` |

---

## 10. Contradictions with `requirement-yogi-dc.md`

| # | Written docs say | Video shows | Resolution |
|---|---|---|---|
| 1 | Keys accept only letters, digits, `_`, `-`, `.` | Any character except `/` and `\`, including Unicode, spaces, `§`, parentheses | **Video wins.** See `RD-023` |
| 2 | Scopes are horizontal table, vertical table, paragraph | Headings too | **Video wins.** Added as a fourth scope |
| 3 | Inline transform works "on this page" | Page **and space**, with an editable regex and occurrence count | **Video wins.** |
| 4 | Searchable property names cannot contain a space | An external property is named `Estimate (Max)` | Both true: it exists and displays, but is awkward to query. Supports `RD-011` |
| 5 | The tab was renamed "External Properties" in 3.6 | Tab reads "Estimates" | Build-dependent; we use "External properties" |
| 6 | Page restrictions are ignored (limitations page) | Stated as a headline and demonstrated end to end | Same conclusion, far stronger evidence for `RD-017` |
