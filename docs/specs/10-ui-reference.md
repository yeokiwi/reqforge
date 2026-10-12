# 10 — GUI specification

**The Reqforge GUI follows the graphical user interface shown in the vendor screencasts.**
Layout, controls, labels, defaults and interaction flows are reproduced as shown. This
file is the contract for every screen. The evidence is in two research notes, each with a
frame index so any claim here can be checked against the picture:

- `docs/research/requirement-yogi-video.md` — authoring, popup, search, restrictions.
- `docs/research/requirement-yogi-videos-2.md` — baselines, diff, Excel import,
  administration, key suggestions, external properties, rename, queue.

The four videos show **two product builds** that differ in the Requirements tab bar.
Where they differ, **the newer build is followed** (`RD-038`).

## 0. What "follow the GUI" means here

`RD-031` fixes the rule. Three columns, no grey areas:

| Reproduced as shown | Ours, deliberately | Behaviour that differs from the video |
|---|---|---|
| Screen layout and regions | Product name and logo — "Reqforge" wherever the video shows "Confluence" or "Requirement Yogi" | Restricted pages hide their requirements (`RD-017`) — the video demonstrates the opposite |
| Every control, in the order shown | No third-party wordmarks, logos or "Powered by" footers | Keys accept Unicode under `RD-023`'s exclusion list |
| UI copy, verbatim, including "page", "macro" and dialog help text (`RD-032`) | Integration items that name a vendor (`Jira Issue/Filter`, `JIRA` badge) are relabelled when integrations ship (phase 3) | |
| Defaults — which boxes start checked, which fields are pre-filled | | |
| Keyboard routes and their names | | |
| Colour *roles* and shapes (pill, chip, badge, lozenge) | Exact hex values are a design decision seeded from the samples in §1 | |

Element status used throughout: **v1** — ships in v1 · **later** — slot exists in the
layout, ships in a later phase · **not built** — omitted, with the reason given.

When this file and another spec disagree about what the user *sees*, this file wins.
When they disagree about what the system *does*, the domain spec wins and this file is
corrected.

---

## 1. Visual language

### 1.1 Colour roles

Seeded from frames sampled in the research note. Treat as starting values for tokens.

| Token | Seed | Used for |
|---|---|---|
| `chrome.nav.bg` | `#093E9B` | top bar |
| `action.create` | `#0D5BFD` | the top-bar `Create` button only |
| `action.primary` | `#0B48B1` | Update, Insert, Apply, search button |
| `surface.page` | `#FFFFFF` | page, popup, dialogs |
| `surface.sidebar` | `#F2F0F3` | space sidebar and icon rail |
| `surface.sidebar.selected` | `#D9DADE` | selected sidebar item |
| `table.header.bg` | `#F0F1F3` | table header rows, in view and edit |
| `pill.key.bg` | `#EDEDF2` | requirement key pills |
| `pill.key.fg` | link blue | requirement key pills |
| `chip.macro.bg` | `#E9E9E9` | editor macro chips |
| `badge.original` | `#198B5A` | `ORIGINAL`, `ORIGINAL DEFINITION` |
| `badge.parent` | `#444964` | `PARENT ↗` |
| `badge.child` | `#626878` | `CHILD ↘` |
| `badge.link` | `#DD8A34` | `LINK`, `TESTS` |
| `badge.external` | `#5A4AA3` | external-system links (the video's `JIRA`) |
| `lozenge.critical` | `#A11911` | status lozenge, red family |
| `lozenge.medium` | `#EE841C` | status lozenge, orange family |

### 1.2 Shapes

| Shape | Looks like | Where |
|---|---|---|
| **Key pill** | small rounded rectangle, `pill.key.bg`, blue key text, no icon | requirement definition in view mode |
| **Link pill** | key pill with a leading `›` | requirement link in view mode |
| **Macro chip** | grey rounded rectangle, product icon, `Requirement │ BR-01` | requirement in edit mode |
| **Badge** | tiny uppercase filled label, white text | popup "See also", search Links column |
| **Lozenge** | uppercase filled label, white text, slightly larger than a badge | status values (`CRITICAL`, `MEDIUM`, `TO DO`) |

---

## 2. Global chrome — top bar

Present on every screen.

```
[⊞] [◆ Reqforge]  Spaces ▾   People   [ Create ]  ···            [🔍 Search      ]  ?  ⚙  🔔  (●)
```

| Element | Status | Behaviour |
|---|---|---|
| App switcher `⊞` | not built | single-product install; nothing to switch to |
| Logo + product name | v1 | home |
| `Spaces ▾` | v1 | recent spaces, then "View all spaces" |
| `People` | later | user directory — drawn inert until built (`RD-052`) |
| **`Create`** | v1 | new page in the current space, or space picker outside one. Until pages exist (slice 1) it is disabled inside a space the user can edit; in a space they cannot edit it is the picker (`RD-052`) |
| `···` | v1 | overflow: Templates, Requirement types (admin) |
| `Search` | v1 | global search over page titles and requirement keys; `Enter` opens results |
| `?` | v1 | help, including the query syntax reference |
| `⚙` | v1 | administration, admins only |
| `🔔` | later | notifications for watched pages — drawn as a disabled button (`RD-052`) |
| Avatar | v1 | profile, API tokens, sign out |

---

## 3. Space sidebar

### 3.1 Collapsed — icon rail

```
[logo]
 ▤   Pages
 ❞   Blog          (not built — see below)
 ⛹   Requirements
 ⇪   Export / open
 ⊶   Page tree
 ···
 ⚙   Space tools
 »   expand
```

### 3.2 Expanded

```
[logo] Team                              ★
 ▤ Pages                                 ← selected: surface.sidebar.selected fill
 ⛹ Requirements
SPACE SHORTCUTS
 ⧉ <shortcut>
PAGE TREE
 ▾ Specifications
     • Page Heading                      ← current page in bold
     › Test session 1a                   ← has children
 › Team
⚙ Space tools                            «
```

| Element | Status | Note |
|---|---|---|
| Space header, star to favourite | v1 | |
| `Pages` | v1 | |
| `Blog` | not built | a blog has no role in a requirements tool; the item is removed rather than left dead |
| `Requirements` | v1 | opens the Requirements screen, §9 |
| `SPACE SHORTCUTS` | v1 | admin-curated links; shown only when the space has shortcuts, which needs the Space tools screens (`RD-052`) |
| `PAGE TREE` | v1 | drag to reorder and re-parent |
| `TRACEABILITY MATRIXES` | v1 | replaces `PAGE TREE` while on the Requirements screen, §9.5 |
| `Space tools` | v1 | permissions, requirement types, key suggestions, history settings — space `ADMIN`s only (`RD-052`) |
| `«` / `»` | v1 | collapse and expand; remembered per user |
| Rail `⇪ Export / open`, `⊶ Page tree` | v1 | the video shows no behaviour; both expand the sidebar (`RD-052`) |
| Rail `···` | not built | nothing to overflow yet (`RD-052`) |

---

## 4. Page view

```
 Pages / Specifications  🔓 📎 ⛹                 ✎ Edit   ☆ Save for later   ◉ Watching   ⇪ Share   ···
 Specifications
 Created by admin, last modified 6 minutes ago

 Business Requirements
 ┌─────────────┬──────────────────────────────────────────────────┬─────────┐
 │ Requirement │ Description                                      │ Owner   │  ← table.header.bg
 ├─────────────┼──────────────────────────────────────────────────┼─────────┤
 │ [BR-01]     │ Lorem ipsum dolor sit amet …                     │ Albert  │
 │ [BR-02]     │ Suspendisse egestas …   › FN-02                  │ Albert  │
 └─────────────┴──────────────────────────────────────────────────┴─────────┘

 Heading 1  [REQ-H1]
 Lorem ipsum [REQ-001] Fusce faucibus …  › FN-02  Vivamus …

 👍 Like   Be the first to like this                                 No labels 🏷
 (●) [ Write a comment…                                                          ]
```

### 4.1 Header

| Element | Status | Behaviour |
|---|---|---|
| Breadcrumb `Pages / <ancestors> / <title>` | v1 | ends with the page itself, not a link (`RD-078`) |
| Byline 🔓 restrictions | v1 | opens §10; icon is a closed red padlock when restricted |
| Byline 📎 attachments | v1 | |
| Byline ⛹ requirements | v1 | opens the product panel, §4.4 |
| `✎ Edit` | v1 | opens the editor, §5; also `E` |
| `☆ Save for later` | v1 | personal favourites |
| `◉ Watching` | v1 | toggles notifications on change; on by default for the author |
| `⇪ Share` | v1 | copy link; share with user |
| `···` | v1 | in the video's order: Attachments · **Page History** (§23) · Restrictions (§10) · People who can view · Page information · View in Hierarchy · Export to Word · **Reqforge** (the §4.4 panel) · Copy · Move · Delete. *Later:* Analytics, Resolved comments, Import Word Document. *Not built:* View Storage Format — a Confluence internals view with no equivalent here |
| Title and `Created by …, last modified …` | v1 | relative time, absolute on hover |

### 4.2 Content rendering

| Content | Renders as |
|---|---|
| Requirement definition | **key pill** `[BR-01]`; hover or click opens the popup, §8 |
| Requirement link | **link pill** `› FN-02`; same popup |
| Several links in one cell | link pills separated by `, ` |
| Requirement in a heading | heading text, two spaces, key pill — `Heading 1  [REQ-H1]` |
| Requirement inline in a paragraph | key pill in the flow of text |
| Status value | lozenge in the configured colour |
| Table header row | `table.header.bg`, bold labels |

Diagnostics in view mode follow `03` §6.4: a byline warning when a required-property
check fails, revealing red pills on demand.

### 4.3 Footer

| Element | Status |
|---|---|
| `👍 Like` · `Be the first to like this` | not built — social signal with no role in a specification |
| `No labels 🏷` / page labels | later |
| Comments, `Write a comment…` | later — review comments are valuable, but they are a feature of their own |

The footer region is laid out in v1 with only the elements that ship, so adding labels
and comments later does not move anything else.

### 4.4 Byline product panel

Clicking the product icon in the byline opens a panel headed by the product logo
(videos-2 §5.1). Items verbatim, in order:

```
 [◆ Reqforge]
 Links:
   • View in search (requirement definitions only)
   • View in search (definitions and links)
   • Dependency matrix
   • Re-index this page
   • Create baseline from this page / and its descendents
   • Compare to baseline…
```

| Item | Does |
|---|---|
| View in search (requirement definitions only) | opens Search with `page = <id>` |
| View in search (definitions and links) | opens Search with `links = <id>` |
| Dependency matrix | opens the Dependencies tab scoped to this page's requirements |
| Re-index this page | reindexes this page as a job (`03` §3) |
| Create baseline from this page | the instant-baseline panel, §15.3; `/ and its descendents` includes child pages |
| Compare to baseline… | picks a baseline and highlights modified requirements on the page (`05` §5) |

---

## 5. Editor

### 5.1 Layout

```
 Paragraph ▾ │ B I U │ A▾ Aᵃ▾ │ ≔ ⒈ ☑ │ ⇤ ⇥ │ ⫷ ⫸ ⫶ │ ▭ │ 🖼 🔗 ▦▾ ☺ │ + ▾ │ ↶ ↷           🔍 ?
 Responsive ▾ │ ⤒row ⤓row ✕row │ ⇤col ⇥col ✕col │ merge split │ hdr-row hdr-col num │ fill ▾ │ ✕table   ← only in a table
 Team / Pages / Specifications  🏷 🔓                                                        (●ᴬ) (+)
 Specifications                                                                     ← editable title
 …content…
 ─────────────────────────────────────────────────────────────────────────────────────────────────────
                      Ready to go   [ What did you change?        ]  ☑ Notify watchers  [Update]  Close  ···
```

| Element | Status | Note |
|---|---|---|
| Toolbar row 1, all groups as drawn | v1 | `Paragraph ▾` = Normal, H1–H6, Quote, Preformatted |
| Toolbar row 2, table tools | v1 | appears **only while the caret is in a table** |
| `Responsive ▾` / `Fixed width ▾` | v1 | table width mode |
| Breadcrumb with label and restriction icons | v1 | `<space> / Pages / <ancestors> / <title>` (`RD-078`) |
| Presence avatars | v1 | shows who else has the page open |
| `+` invite collaborator | later | real-time co-editing is phase 3; v1 detects a concurrent save and offers merge or overwrite |
| Save state | v1 | exactly three strings: **`Ready to go`**, **`Saving changes`**, **`Changes saved`** |
| `What did you change?` | v1 | becomes the version's change note |
| `☑ Notify watchers` | v1 | checked by default |
| **`Update`** | v1 | publishes the version and returns to view mode; disabled while a file is uploading (`RD-076`) |
| `Close` | v1 | returns to view mode, keeping the draft |
| `···` | v1 | Revert to last published, Page history |

Where a glyph is not self-explanatory, the reading chosen is in `RD-057`. Autosave, `Update`,
`Close`, conflict handling and `Revert to last published` follow `RD-055`; their timings,
the upload guard and the leave-page prompt are `RD-076`. Pasted, dropped and Markup content
that would nest deeper than 64 levels is flattened to its text blocks (`RD-077`).

### 5.2 Macro chips

| Macro | Chip text |
|---|---|
| Definition | `⛹ Requirement │ BR-01` |
| Link | `⛹ Requirement │ Link │ FN-06` |
| Link showing a target property | `⛹ Requirement │ Link │ FN-01 │ @Priority,` |
| Link pinned to a baselined version | `⛹ Requirement │ Link │ BR-01 │ 1` — the trailing number is the baseline |
| Placeholder while the key is being chosen | `⛹ Requirement` (greyed) |

Several link chips in one cell **stack vertically**, one per line.

Clicking a **definition** chip opens the key picker (§6.1). Clicking a **link** chip opens
a popover with three actions, verbatim (videos-2 §2.5):

```
 Transform to definition · View detail of BR-01 v.1 · Remove
```

`Transform to definition` turns the link into the definition — refused with a message if
the key is already defined elsewhere (`03` rule S3). `View detail of …` opens the
requirement page. Pasting a requirement URL into the editor creates a link chip; pasting
a baselined requirement's URL creates a pinned one.

### 5.3 Three ways to insert a Requirement macro

Named as the video names them:

| Route | What the user does |
|---|---|
| **Keyboard shortcut `Alt + Shift + R`** | inserts a placeholder chip and opens the key picker (§6.1); with several cells or lines selected, opens the bulk dialog (§6.3) |
| **`{requirement`** | typing `{` opens **Macro suggestions**; typing on filters; `Requirement` inserts the macro |
| **Insert More Content Menu** | `+ ▾` → `Requirement` |

### 5.4 `{` Macro suggestions

```
 Macro suggestions
   ⓘ Info
   ═ Status
   ▦ Gallery
   ☰ Table of Contents
   ⛹ Requirement
   ··· Open macro browser
```

Order as shown. Typing after `{` filters by name; the list reorders by recency once the
user has inserted something.

### 5.5 Insert More Content menu

| Item | Status |
|---|---|
| Files and images | v1 |
| Link | v1 |
| Markup | v1 — paste Markdown or HTML and convert |
| Horizontal rule | v1 |
| Task list | v1 |
| Date | v1 |
| Symbol | v1 |
| User mention | v1 |
| Jira Issue/Filter | later — becomes the generic external-issue macro when integrations ship |
| Info | v1 — info panel |
| Status | v1 — lozenge |
| Gallery | later |
| Table of Contents | v1 |
| **Requirement** | v1 |
| — `Other macros` | v1 — opens the macro browser, which also lists **Requirement report**, **Traceability matrix** and **Baseline** |

---

## 6. Requirement macro interactions

### 6.1 Key picker

Opens under a placeholder or clicked chip:

```
 [Remove]  [ Enter requirement key            ]
   • Create BR-08
   • Create FN-12
   • Create TECH-008
```

| Element | Behaviour |
|---|---|
| `Remove` | deletes the macro |
| `Enter requirement key` | focused on open; typing an existing key turns the list into matching **existing requirements** to link to |
| `• Create <key>` | one line per registered key pattern in the space — the next key of each (`03` §4.2) |

`Enter` takes the highlighted line; `Esc` keeps the placeholder and closes the picker.

### 6.2 Invalid key

Shown in the picker, under the field, the moment the key fails validation:

```
 [Remove]  [ REQ/006\                        ]
 "REQ/006\" is not a valid key.
```

The message template is exactly `"<key>" is not a valid key.` Soft warnings
(`KEY_AWKWARD`, `03` §4.1) use the same position in amber and do not block.

### 6.3 Bulk insert dialog

Title **`Insert the Requirement macro`**. Two variants, chosen by what is selected.

**Variant A — the selection is empty cells or lines:**

```
 Insert the Requirement macro                                            ✕
 ────────────────────────────────────────────────────────────────────────
 This will create one macro for each of the 6 lines.

 Prefix and first number   [ TECH-          ] [ 008   ]
                           (Mandatory) A prefix, and the first number of your
                           requirements. Don't forget to pad with leading 0s, so
                           requirements are sorted when in alphabetical order.
 ────────────────────────────────────────────────────────────────────────
 Reqforge (Alt + Shift + R)                                [Insert]  Cancel
```

Both fields are **pre-filled from the next suggested key** of the most-used pattern in
the page, split into prefix and zero-padded number.

**Variant B — the selection contains text:**

```
 Insert the Requirement macro                                            ✕
 ────────────────────────────────────────────────────────────────────────
 This will create one macro for each of the 3 lines.

 Mode    ◉ Use selected text as keys
           Requires that the selected text already contains numbered
           requirements with a prefix.
         ○ Generate numbers automatically
           The macros will be inserted before the selection.

 Prefix  [            ]  FN-12
         (Optional) A prefix to insert before the requirement numbers. It is
         mandatory when the selection only contains numbers.
 ────────────────────────────────────────────────────────────────────────
 Reqforge (Alt + Shift + R)                                [Insert]  Cancel
```

The greyed `FN-12` beside the Prefix field is a placeholder hint showing the shape of a
suggested key.

Behavioural rules — `03` §6.2: the line count is computed before the dialog opens and
is honoured exactly; the whole selection is validated before anything is inserted;
a failure lists the offending lines and inserts nothing.

### 6.4 Inline dialog — view mode

Opens when the user selects text in a rendered page that looks like a key. The
selected text stays highlighted.

**Default state:**

```
 Type*
 [ Inline                                           ▾ ]
 Refresh
 "Inline" is the same as editing the page and inserting with [ Alt + Shift + R ].

 ☑ Make links for every "REQ-567" on this page.            ← checked, disabled
 ☑ Make links for every "REQ-567" in this space.           ← checked
 ☐ Create similar definitions for all "REQ-"✎ on this      ← unchecked
   page (about 2 other occurrences).

 [Create]  Cancel
```

**After clicking ✎:**

```
 ☑ Create similar definitions for all
   [ REQ-[A-Za-z0-9._-]+          ] on this page (about 2 other
   occurrences – The pattern must be a regex of the complete key,
   see regex documentation here).
```

| Element | Behaviour |
|---|---|
| `Type*` | v1 offers `Inline` only. The video shows a dropdown; its other options are not visible (gap — research §6.2), so the control is rendered and later types slot in |
| `Refresh` | recounts occurrences, e.g. after editing the regex |
| First checkbox | always applies; shown checked and disabled so the user can see it will happen |
| `…in this space.` | checked by default |
| `Create similar definitions…` | unchecked by default; the quoted prefix is the selected key up to and including its last separator |
| ✎ | reveals the regex. Default: the escaped prefix followed by `[A-Za-z0-9._-]+` for an ASCII key, or `[^\s/\\]+` otherwise (`RD-023`) |
| Occurrence count | live, `about N other occurrences` |
| `Create` | runs the transform as one job (`03` §6.3) |

---

## 7. Link badge vocabulary

One vocabulary for the popup, the search Links column and matrix cells.

| Badge | Colour token | Meaning |
|---|---|---|
| `ORIGINAL DEFINITION` | `badge.original` | popup header: this occurrence defines the requirement |
| `ORIGINAL` | `badge.original` | Links column: the defining page |
| `LINK` | `badge.link` | a page that cites the requirement |
| `THISPAGE` | `badge.link` | a citation on the page currently open, in place of `LINK` (videos-2 §5.2) |
| `PARENT ↗` | `badge.parent` | dependency toward the parent; relationship follows in parentheses |
| `CHILD ↘` | `badge.child` | dependency toward the child; relationship follows in parentheses |
| `TESTS` | `badge.link` | test results (phase 3) |
| external system name | `badge.external` | linked issue (phase 3) — the video's `JIRA` badge |

Format: `[BADGE] (relationship) KEY summary` — the relationship in parentheses only for
dependencies and external links.

- A **cross-space** target renders as `KEY in space 'SPACE'`:
  `[PARENT ↗] (parent_requirement) BRTEST-001 in space 'BUGTESTS'`.
- A **baselined** target renders with its version: `[CHILD ↘] FN-02 v1 (relates)`.

**State badges** used on the Baselines and Diff tabs, same shape as link badges:

| Badge | Colour | Where |
|---|---|---|
| `DONE` | `badge.original` (green) | baseline status, §14 |
| `MODIFIED` | dark indigo | diff state, §16 |
| `REMOVED` | `badge.link` (amber) | diff state |
| `ADDED` | `badge.original` (green) | diff state — not shown in the videos; colour by analogy |

`NON EXISTING` is red **text**, not a badge, in the column where the requirement is
absent.

---

## 8. Requirement popup

```
 ┌────────────────────────────────────────────────────────────────────┐
 │ FN-01  [ORIGINAL DEFINITION]                      Current  [<] [>] │
 │ Phasellus ex sapien, tincidunt quis tortor ut, pretium volutpat…   │
 │ Click to expand…                                                   │
 │   • Cost: $2700                                                    │
 │   • Description: Phasellus ex sapien, tincidunt quis …             │
 │   • Estimate*: 5                                                   │
 │   • Estimate (Max)*: 10                                            │
 │   • Priority: [CRITICAL]                                           │
 │   • Relates: BR-01                                                 │
 │   • Suspect*: true                                                 │
 │ See also:                                                          │
 │   • [PARENT ↗] (relates) BR-01                                     │
 │   • [CHILD ↘] (functional_requirement) TECH-001                    │
 │   • [LINK] Test session 1                                          │
 │ Tests:                                                             ║ ← scrolls
 │   • [TESTS] | ✅ Success | ✅ | ✅ | ✅                             │
 └────────────────────────────────────────────────────────────────────┘
```

| Region | Rule |
|---|---|
| Header | key · state badge · `Current` with `[<]` `[>]` stepping through versions. On a baselined version the header reads **`BR-01 v1  v1 - Baseline 1  [<] [>]`** (videos-2 §2.4) |
| Excerpt | first lines of the description, then **`Click to expand…`**, expanding in place |
| Properties | bulleted `Name: value`; **names are links** that run `@Name = 'value'`; **values keep their rendering** (lozenges stay lozenges); external properties carry a trailing **`*`** |
| `See also:` | dependencies first (parents, then children), then citing pages, then external links |
| `Tests:` | hidden until the testing module exists |
| Height | fixed maximum; the body **scrolls internally** |
| Footer | **`See all versions of this requirement`** — opens Search with `key = 'BR-01'` and all versions shown |
| Opening | on hover after 300 ms, or on click; one request per open (`RD-028`) |

---

## 9. Requirements screen

Opened from the sidebar `Requirements` item. The sidebar switches its lower section to
`TRACEABILITY MATRIXES` (§9.5). Every tab has a page heading above the tab bar —
`Requirements` for Search, Traceability and External properties; `Baselines`; `Diff`;
`Create a baseline` inside the wizard.

### 9.1 Tab bar

The newer build's tab bar (`RD-038`):

```
 Search   Coverage   Dependencies   Traceability   Baselines   Diff   Reports   External properties      ⚙  ?   [◆ Reqforge]
 ‾‾‾‾‾‾
```

| Tab | Status | Spec |
|---|---|---|
| **Search** | v1 | §9.2–9.4, `02` |
| **Coverage** | v1 | `04` §4 |
| **Dependencies** | v1 | `04` §3 |
| **Traceability** | v1 | §20, `04` §2 |
| **Baselines** | v1 | §14–15, `05` §1–4 |
| **Diff** | v1 | §16, `05` §5 |
| **Reports** | v1 | every saved traceability matrix and report in the space, with owner and visibility — the content of this tab is never shown in the videos (videos-2 §7), so it is ours |
| **External properties** | v1 | §24 |

There is no separate Excel tab. Excel import is reached from links at the foot of the
External properties tab (§24), as in the newer build.

The active tab is underlined. `⚙` opens space requirement settings; `?` opens the query
syntax help.

### 9.2 Query bar

```
 [                                                        ] [🔍]  [ Filters        ▾ ]
 [ Ctrl + Space ] for help, or lookup the search syntax.
 Requirements - all of them and in space 'TEAM' and with status 'ACTIVE'
 80 requirements.
```

| Element | Rule |
|---|---|
| Query field | RQL (`02`); `Ctrl + Space` opens completion (`02` §8.2). A bare word is a valid query — `KEY` searches keys and text (`02` §3.2) |
| Query history | focusing the empty field lists the user's recent queries, most recent first, at most 10 (videos-2 §4.5) |
| `🔍` | runs the query; `Enter` does the same |
| `Filters ▾` | quick toggles that edit the query text visibly: Cross space, Show all baselines, Include deleted |
| Hint line | verbatim: `[ Ctrl + Space ] for help, or lookup the search syntax.` — "search syntax" is a link |
| Echo line | `describe()` output (`02` §8.1), in the video's register: `Requirements - all of them and in space 'TEAM' and with status 'ACTIVE'`, `Requirements containing 'KEY' and …`, `Requirements with key starting with 'Business' and …` |
| Count | `N requirements.` on its own line |

### 9.3 Pager line

```
 Previous – 1-30 of 80 results – Next – Show all versions – Export to Excel – CSV – Cross-space search
```

Verbatim, right-aligned, links separated by ` – `. Page size **30**. `Export to Excel`
and `CSV` run export jobs; `Cross-space search` is hidden when the space is isolated.

`Show all versions` adds baselined rows, and then:

- the link itself reads **`Show current only`**;
- the echo line gains `… or with status 'ARCHIVED'`;
- **baselined rows have a grey background**, and their keys read **`BR-01 v1`**;
- actions that edit are disabled on baselined rows — *"You can only edit requirements in
  the Current version."*

### 9.4 Results table

```
 [☐] [Actions ▾]   Key       Description                                   Links
 ─────────────────────────────────────────────────────────────────────────────────────────
 [☐]               [BR-01]   Lorem ipsum dolor sit amet, consectetur …     • [ORIGINAL] Specifications
                                                                           • [CHILD ↘] FN-01 (relates)
                                                                           • [LINK] What is important – Specifications
```

| Element | Rule |
|---|---|
| Header checkbox | selects **every requirement matching the query**, beyond the page; the Actions menu then says how many |
| `Actions ▾` | **Rename** (§17) · **Make Baseline** (§15) · **Generate Diff** (§16, prefilled with the selection) · **Bulk edit external property** · Export selection. *Later:* Create Test Session procedure |
| Key | key pill, opens the popup |
| Description | full text, wrapped |
| Links | bulleted badges per §7. In this column the relationship follows the key: `[CHILD ↘] FN-01 (relates)` — as shown in the video |

### 9.5 Sidebar — traceability matrixes

```
 TRACEABILITY MATRIXES
  ▾ Recently viewed
     • Cascade Matrix
     • Estimates on BR
  ▾ Your queries
     • BR requirements Trace…
     • FN requirements Trace…
  ▾ Shared by others
     • Key Traceability
  • View all
```

Headings verbatim. Four groups, from the two builds (videos-2 §4.3):

| Group | Holds |
|---|---|
| `Recently viewed` | the last 8 saved views this user opened |
| `Your queries` | saved views this user owns |
| `Shared by others` | saved views other users made visible to the space |
| `View all` | the Reports tab |

An empty group is omitted, not shown empty.

---

## 10. Restrictions dialog

Opened from the page byline padlock or `··· → Restrictions`.

```
 Restrictions                                                             Help
 ─────────────────────────────────────────────────────────────────────────────
 [🔓 No restrictions ▾]   Everyone can view and edit this page.

 [illustration]   Who can see this?
                  Right now everyone can view and edit this page if they've got
                  the right space permissions. Use the dropdown above to restrict
                  this page to only some people.
                  Learn more about restrictions
 ─────────────────────────────────────────────────────────────────────────────
                                                              [Apply]  Cancel
```

Mode dropdown, verbatim:

| Option | Subtitle | Icon |
|---|---|---|
| No restrictions | Everyone can view and edit | open padlock |
| Editing restricted | Everyone can view, only some can edit | open padlock |
| Viewing and editing restricted | Only some can view or edit | **red closed padlock** |

With a restricted mode selected, the explanation panel is replaced by:

```
 [🔒 Viewing and editing restricted ▾]   Only some people can view or edit.
 [ Type a user name or group                ] [ Can view and edit ▾ ]  [Add]
   👥 Everyone                                  Has no access
   👤 admin (admin)                             Can view and edit
```

Permission dropdown values: `Can view and edit`, `Can view` (the latter only in
Viewing-and-editing-restricted mode). `Apply` is disabled until something changes.

**Behaviour divergence, stated plainly.** In the video, the requirement on the
restricted page remains fully visible in the Requirements screen. In Reqforge it does
not — restriction applies to every requirement defined on the page, everywhere (`07`
§2.2, `RD-017`). So this dialog adds one line under the status text whenever the page
defines requirements:

> *Requirements defined on this page follow these restrictions.*

The GUI follows the video. The behaviour does not, and the dialog says so.

---

## 11. URLs

| Surface | Path |
|---|---|
| Page | `/spaces/{SPACE}/pages/{pageId}` |
| Page version | `/spaces/{SPACE}/pages/{pageId}?version={n}` — read-only, with a banner back to current |
| Page history | `/spaces/{SPACE}/pages/{pageId}/history` |
| Compare two versions | `/spaces/{SPACE}/pages/{pageId}/history/compare?a={n}&b={m}` (`RD-060`) |
| Space overview (the page tree) | `/spaces/{SPACE}`, and `?highlight={pageId}` for *View in Hierarchy* |
| Editor | `/spaces/{SPACE}/pages/{pageId}/edit` |
| Requirement, live | `/requirements/{SPACE}/{KEY}` — the form in the video's status bar |
| Requirement, baselined | `/requirements/{SPACE}/{KEY}/{baselineNumber}` — the baseline number *in the URL*, as the video says (`RD-044`) |
| Baselines tab | `/requirements/{SPACE}/baselines` |
| Create a baseline | `/requirements/{SPACE}/baselines/new?scope=…` |
| Diff | `/requirements/{SPACE}/diff?a=…&b=…` |
| Space settings — requirements | `/spaces/{SPACE}/settings/requirements/{options\|reindex\|key-suggestions\|trash}` |
| Administration | `/admin/requirements/{tab}` |
| Requirements screen | `/requirements/{SPACE}?tab=search&q=…` |
| Saved matrix | `/requirements/{SPACE}/matrices/{id}` |

Keys are percent-encoded (`03` §4.1). Round-trip tests use `日本語の文字-001` and
`REQ 005`.

---

## 12. Empty, error and restricted states

The video shows only populated screens, so these are ours, in its register.

| State | Copy |
|---|---|
| Space with no requirements | "No requirements yet. Edit a page and press Alt + Shift + R to insert one." |
| Query matched nothing | the echo line, then "0 requirements." and a link: "Search all baselines and statuses" |
| Over a display limit | "This shows 200 × 200 requirements at most. Export to Excel to see all 412." |
| Restricted content | rows omitted; where a total would mislead: "Some requirements are hidden by page restrictions." |
| Query error | the field underlines the offending span; the message from `02` §9 replaces the echo line |

---

## 13. Copy deck

Strings reproduced verbatim from the video, with ids for tests to assert against. A
change to any of these is a GUI change and needs a decision-log entry.

| Id | String |
|---|---|
| `editor.state.ready` | Ready to go |
| `editor.state.saving` | Saving changes |
| `editor.state.saved` | Changes saved |
| `editor.changeNote.placeholder` | What did you change? |
| `editor.notifyWatchers` | Notify watchers |
| `editor.update` | Update |
| `editor.close` | Close |
| `picker.placeholder` | Enter requirement key |
| `picker.remove` | Remove |
| `picker.create` | Create {key} |
| `key.invalid` | "{key}" is not a valid key. |
| `autocomplete.title` | Macro suggestions |
| `autocomplete.browser` | Open macro browser |
| `insertMenu.otherMacros` | Other macros |
| `bulk.title` | Insert the Requirement macro |
| `bulk.count` | This will create one macro for each of the {n} lines. |
| `bulk.prefixAndFirst.label` | Prefix and first number |
| `bulk.prefixAndFirst.help` | (Mandatory) A prefix, and the first number of your requirements. Don't forget to pad with leading 0s, so requirements are sorted when in alphabetical order. |
| `bulk.mode.label` | Mode |
| `bulk.mode.useText` | Use selected text as keys |
| `bulk.mode.useText.help` | Requires that the selected text already contains numbered requirements with a prefix. |
| `bulk.mode.generate` | Generate numbers automatically |
| `bulk.mode.generate.help` | The macros will be inserted before the selection. |
| `bulk.prefix.label` | Prefix |
| `bulk.prefix.help` | (Optional) A prefix to insert before the requirement numbers. It is mandatory when the selection only contains numbers. |
| `bulk.footer` | Reqforge (Alt + Shift + R) |
| `bulk.insert` | Insert |
| `inline.type` | Type |
| `inline.refresh` | Refresh |
| `inline.type.help` | "Inline" is the same as editing the page and inserting with [ Alt + Shift + R ]. |
| `inline.linksPage` | Make links for every "{key}" on this page. |
| `inline.linksSpace` | Make links for every "{key}" in this space. |
| `inline.similar` | Create similar definitions for all "{prefix}" on this page (about {n} other occurrences). |
| `inline.similar.regex` | Create similar definitions for all {regex} on this page (about {n} other occurrences – The pattern must be a regex of the complete key, see regex documentation here). |
| `inline.create` | Create |
| `popup.original` | ORIGINAL DEFINITION |
| `popup.current` | Current |
| `popup.expand` | Click to expand… |
| `popup.seeAlso` | See also: |
| `popup.tests` | Tests: |
| `search.hint` | [ Ctrl + Space ] for help, or lookup the search syntax. |
| `search.count` | {n} requirements. |
| `search.pager` | Previous – {from}-{to} of {n} results – Next – Show all versions – Export to Excel – CSV – Cross-space search |
| `search.actions` | Actions |
| `sidebar.matrices` | TRACEABILITY MATRIXES |
| `sidebar.recent` | Recently viewed |
| `sidebar.shared` | Shared by others |
| `sidebar.viewAll` | View all |
| `restrictions.title` | Restrictions |
| `restrictions.none` | No restrictions |
| `restrictions.none.sub` | Everyone can view and edit |
| `restrictions.none.status` | Everyone can view and edit this page. |
| `restrictions.edit` | Editing restricted |
| `restrictions.edit.sub` | Everyone can view, only some can edit |
| `restrictions.view` | Viewing and editing restricted |
| `restrictions.view.sub` | Only some can view or edit |
| `restrictions.view.status` | Only some people can view or edit. |
| `restrictions.picker` | Type a user name or group |
| `restrictions.canViewEdit` | Can view and edit |
| `restrictions.noAccess` | Has no access |
| `restrictions.who` | Who can see this? |
| `restrictions.explain` | Right now everyone can view and edit this page if they've got the right space permissions. Use the dropdown above to restrict this page to only some people. |
| `restrictions.learnMore` | Learn more about restrictions |
| `restrictions.requirementsNote` | Requirements defined on this page follow these restrictions. *(ours — §10)* |
| `page.byline` | Created by {author}, last modified {relative} |
| `page.edit` / `page.saveForLater` / `page.watching` / `page.share` | Edit / Save for later / Watching / Share |
| `byline.panel.viewDefinitions` | View in search (requirement definitions only) |
| `byline.panel.viewAll` | View in search (definitions and links) |
| `byline.panel.dependencyMatrix` | Dependency matrix |
| `byline.panel.reindex` | Re-index this page |
| `byline.panel.baseline` | Create baseline from this page |
| `byline.panel.baselineDesc` | and its descendents |
| `byline.panel.compare` | Compare to baseline… |
| `chip.link.transform` | Transform to definition |
| `chip.link.view` | View detail of {key} v.{n} |
| `chip.link.remove` | Remove |
| `popup.allVersions` | See all versions of this requirement |
| `popup.baselineLabel` | v{n} - {baselineName} |
| `search.pager.currentOnly` | Show current only |
| `search.readOnlyVersion` | You can only edit requirements in the Current version. |
| `search.action.rename` | Rename |
| `search.action.makeBaseline` | Make Baseline |
| `search.action.generateDiff` | Generate Diff |
| `search.action.bulkExternal` | Bulk edit external property |
| `sidebar.yourQueries` | Your queries |
| `tabs.reports` | Reports |
| `tabs.externalProperties` | External properties |
| `baselines.intro` | Baselines save a frozen snapshot of your requirements at a certain point of time. |
| `baselines.intro.b1` | That's useful when you raise an issue about a specific version of your requirements. *(video: "a Jira issue" — vendor name removed, `RD-031`)* |
| `baselines.intro.b2` | You can also create a baseline from the search screen with a subset of your requirements. |
| `baselines.generateDiff` | Generate diff |
| `baselines.create` | Create a new baseline |
| `baselines.searchPlaceholder` | Search for a baseline |
| `baselines.count` | {n} baselines |
| `baselines.col.id` / `.name` / `.pageCount` / `.count` / `.status` / `.actions` | ID / Name / Page Count / Count / Status / Actions |
| `baselines.pages` | {n} page / {n} pages |
| `baselines.requirements` | {n} requirements |
| `baselines.status.done` | DONE |
| `baselines.rename` / `.refreeze` / `.delete` | Rename / Refreeze / Delete |
| `wizard.title` | Create a baseline |
| `wizard.steps` | Search · Baseline options · Dependencies · Create |
| `wizard.name.help` | Define a name for this baseline |
| `wizard.scope.title` | Choose requirements |
| `wizard.scope.question` | Which requirements do you want to use? |
| `wizard.scope.selected` | Reuse the selected requirements: {query} |
| `wizard.scope.searched` | Reuse the searched requirements: {query} |
| `wizard.scope.space` | All requirements in this space |
| `wizard.links.title` | Links |
| `wizard.links.body` | As people keep updating the requirements after this baseline: • The text and properties of the "frozen" requirements won't change. • It is possible to link to a specific version: In the editor, either paste a URL directly, or click on the macro and choose the version number. |
| `wizard.summaryPage` | This action will create a page with a summary of the baseline. |
| `wizard.when` | When |
| `wizard.when.now` | Freeze requirements now |
| `wizard.when.later` | Freeze requirements later |
| `wizard.when.later.help` | Freeze requirements later if you are anticipating on a future baseline and you want to add details. |
| `wizard.page` | Baseline page |
| `wizard.page.none` | None (simple) |
| `wizard.page.create` | Create a baseline and an associated page |
| `wizard.page.help` | The associated page will display the baseline details and a few requirements. It is not compulsory to create a page, since the details can be found in the list of baselines. |
| `wizard.submit` | Create baseline |
| `instant.back` | Back |
| `instant.title` | Create an instant baseline from this page |
| `instant.defaultName` | Baseline {n} for {pageTitle} |
| `diff.title` | Diff |
| `diff.first` | First query: |
| `diff.second` | Second query: |
| `diff.generate` | Generate diff |
| `diff.display` / `.compare` / `.limit` | Display / Compare / Limit ({n}) |
| `diff.descriptions` | Display descriptions |
| `diff.insertMacro` | Insert as a macro |
| `diff.col.state` | State |
| `diff.col.set2` | Set 2 |
| `diff.nonExisting` | NON EXISTING |
| `diff.state.modified` / `.removed` / `.added` | MODIFIED / REMOVED / ADDED |
| `diff.compare.description` / `.external` / `.dependencies` / `.issues` | Description / External properties / Dependencies / Issues |
| `rename.title` | Rename requirements |
| `rename.ignoreErrors` | Ignore integration errors *(video: "Ignore Jira errors", `RD-031`)* |
| `rename.col.prefix` / `.middle` / `.suffix` | Prefix / Middle / Suffix |
| `rename.submit` | Rename |
| `task.elapsed` | Time Elapsed: {d} |
| `task.remaining` | Time Remaining: {d} (estimated) |
| `task.completion` | Completion: {p}% complete |
| `task.stop` | Stop and cancel this task |
| `rename.done` | Rename task finished successfully. |
| `rename.info` | Reqforge modified {m} macros on {p} pages to rename {r} requirements. |
| `reindex.title` | Reindex the space |
| `reindex.intro` | If requirements are not up-to-date, this task will help you reindex the space. You will be able to interrupt the task at any moment without consequence. |
| `reindex.submit` | Reindex |
| `reindex.steps` | This task first searches for pages of the space (step 1: 5%), then resets the requirement definitions (step 2: 20%), then reindexes them (step 3: 75%). |
| `keys.intro` | Users generate new requirement keys in the editor. These options allow administrators to control which keys are generated. |
| `keys.settings` | Settings |
| `keys.useGlobal` | Use global settings |
| `keys.useGlobal.help` | Default: Ticked. Inherit global settings for this space. If unticked, you can select the options below. |
| `keys.linksAcross` | Links across spaces |
| `keys.linksAcross.help` | Recommended: Ticked. If ticked, suggests requirements from other spaces when creating a link. Note: It is still possible to insert a cross-space link by pasting a direct link. |
| `keys.preventReuse` | Prevent reusing deleted keys |
| `keys.preventReuse.help` | Default: Unticked. If ticked, deleted requirement keys are never suggested again. Unless you wish to fully disable a key, you may prefer to keep every label available. |
| `keys.global` | Generate global keys |
| `keys.global.help` | Default: Unticked. If ticked, the generated keys will be unique across the entire instance. |
| `keys.lock` | Lock keys |
| `keys.lock.help` | Default: Unticked. If ticked, the user must select among the keys of the table below. |
| `keys.table` | Key Suggestions |
| `keys.col.prefix` / `.number` / `.suffix` / `.actions` | Prefix / Number / Suffix / Actions |
| `keys.add` / `.delete` / `.search` | Add / Delete / Search |
| `ext.intro` | External properties help you assign a value to requirements without editing the original page. They can be very useful for estimates or for the Excel loop with your customer. |
| `ext.upload` | Upload Excel file |
| `ext.title` | External properties |
| `ext.range` | {from}-{to} out of {n} |
| `ext.create` | Create new |
| `ext.col.type` / `.key` / `.actions` | Type / Key / Actions |
| `ext.excelLinks` | Legacy Excel import — New Excel import |
| `trace.search` | Search: |
| `trace.search.help` | Optional. A normal search query, see search syntax. |
| `trace.builtIn` | Built in {ms} ms. |
| `trace.toolbar` | Page size – {n} requirements – Show baselines – Cross-space – Export traceability matrix – |
| `trace.insertMacro` | Insert as a macro |
| `trace.addProperty` | + Add property |
| `trace.addExternal.title` | Add external property column |
| `trace.addExternal.search` | Start typing to search... |
| `trace.addExternal.create` | Or create a new one |
| `admin.tabs` | Getting started · Options · Queue · Integrations · Properties · Key suggestions · Upgrade tasks · Logging · Support · Usage metrics · Tutorials / checklist |
| `admin.limits` | Limits |
| `admin.globalLimit` | Global limit |
| `admin.globalLimit.help` | Default is 12 000. Maximum number of requirements that can be treated together at any time. Leave empty if unsure. |
| `admin.permissions` | Permissions |
| `admin.rename` | Requirements rename |
| `admin.rename.help` | Comma-separated list of groups who are allowed to rename requirements. By default, only space administrators can use this feature. If a group is present, the user has to either be space admin, either be able to both edit the space and be in this group. |
| `admin.baselineDeletion` | Baseline deletion |
| `admin.baselineDeletion.help` | Comma-separated list of groups who are allowed to delete baselines. By default, only space administrators can use this feature. If a group is present, the user has to either be space admin, either be able to both edit the space and be in this group. |
| `admin.export` | Allow export for anyone who can view requirements |
| `admin.export.help` | Default: Ticked. If you have performance issues with people exporting en masse, then disable this box, and the software will fall back on the normal export permissions. Note: Anyone who can view requirements can always export them, with or without this option, using the REST API. This checkbox can only prevent the CPU-intensive operation of exporting to Excel. |
| `admin.properties.help` | Changing the type of a property allows you to perform calculations in the Estimate tool. Properties are global: The type of a property is the same across all spaces, and if you press 'Remove', it will remove the values for this external property for the whole instance. |
| `admin.properties.col` | Property name / Data type / INLINE / EXTERNAL / Actions |
| `admin.types` | Text / Decimal number / Integer / Boolean / Dropdown |
| `queue.toolbar` | Delete all - Filter by status - Filter by queue - Filter by instance · Refresh |
| `queue.stats` | Statistics |
| `queue.stats.col` | Queue / Last execution / NEW / RETRY / DONE / FAILED |
| `queue.messages` | Messages |
| `queue.col` | Message ID / Queue / Author / Contents / Status / Actions |
| `queue.retry` | Retry |
| `queue.personal` | Personal queue |
| `metrics.note` | We don't do telemetry, these metrics are just for you. |
| `metrics.sections` | Top 20 spaces · Most recent spaces · Most recent users · Usage statistics (1 year) |
| `deleted.title` | Requirement {key} |
| `deleted.body` | The requirement is DELETED. It used to be on the page {page}. See below for the deleted requirement. |
| `deleted.details` | Details of {key} |
| `history.title` | Page History |
| `history.intro` | View, compare, or restore historical versions of this page. Older versions may be automatically deleted based on rules set by your administrator. |
| `history.compare` | Compare selected versions |
| `history.col` | Version / Published / Changed By / Comment / Actions |
| `history.current` | CURRENT (v. {n}) |
| `history.baselineComment` | Baseline "{name}" for Reqforge |
| `history.restore` / `.delete` | Restore / Delete |

### 13.1 Shell, sign-in and placeholders (`RD-050`)

Strings for the chrome of §2–3 and for screens the video never shows. Where §2–3 draw a
label it is reproduced verbatim; labels marked *(ours)* are accessible names and empty
states the video has no equivalent for. The table has the same shape as the one above and
is read by the same generator.

| Id | String |
|---|---|
| `app.name` | Reqforge |
| `shell.spaces` | Spaces |
| `shell.spaces.recent` | Recent *(ours)* |
| `shell.spaces.viewAll` | View all spaces |
| `shell.people` | People |
| `shell.create` | Create |
| `shell.create.pickSpace` | Choose a space *(ours)* |
| `shell.create.noSpace` | You can't create pages in any space. *(ours)* |
| `shell.more` | More *(ours)* |
| `shell.more.templates` | Templates |
| `shell.more.requirementTypes` | Requirement types |
| `shell.search.placeholder` | Search |
| `shell.search.label` | Search pages and requirement keys *(ours)* |
| `shell.help` | Help *(ours)* |
| `shell.admin` | Administration *(ours)* |
| `shell.notifications` | Notifications *(ours)* |
| `shell.avatar` | Account *(ours)* |
| `shell.avatar.profile` | Profile |
| `shell.avatar.tokens` | API tokens |
| `shell.avatar.signOut` | Sign out |
| `shell.later` | Not available yet *(ours)* |
| `sidebar.nav` | Space navigation *(ours)* |
| `sidebar.pages` | Pages |
| `sidebar.requirements` | Requirements |
| `sidebar.shortcuts` | SPACE SHORTCUTS |
| `sidebar.pageTree` | PAGE TREE |
| `sidebar.rail.pageTree` | Page tree |
| `sidebar.rail.exportOpen` | Export / open |
| `sidebar.spaceTools` | Space tools |
| `sidebar.collapse` | Collapse sidebar *(ours)* |
| `sidebar.expand` | Expand sidebar *(ours)* |
| `sidebar.favourite` | Add {space} to your starred spaces *(ours)* |
| `sidebar.unfavourite` | Remove {space} from your starred spaces *(ours)* |
| `sidebar.pageTree.empty` | No pages yet. *(ours)* |
| `sidebar.tools.permissions` | Permissions |
| `sidebar.tools.requirementTypes` | Requirement types |
| `sidebar.tools.keySuggestions` | Key suggestions |
| `sidebar.tools.history` | History settings |
| `spaces.title` | Spaces *(ours)* |
| `spaces.none` | You don't have access to any spaces yet. *(ours)* |
| `space.empty` | This space has no pages yet. *(ours)* |
| `auth.title` | Sign in to {app} *(ours)* |
| `auth.email` | Email *(ours)* |
| `auth.password` | Password *(ours)* |
| `auth.submit` | Sign in *(ours)* |
| `auth.error` | Incorrect email or password. *(ours)* |
| `auth.throttled` | Too many attempts. Try again in a few minutes. *(ours)* |
| `profile.title` | Profile *(ours)* |
| `profile.name` | Name *(ours)* |
| `profile.email` | Email *(ours)* |
| `globalSearch.title` | Search results *(ours)* |
| `globalSearch.none` | No results for "{q}". *(ours)* |
| `reserved.body` | This screen is part of a later release. *(ours)* |
| `error.notFound` | We couldn't find that page. *(ours)* |

### 13.2 Page view, byline and page menus (slice 1)

Owner: the page-view agent. Read `RD-059` first.

| Id | String |
|---|---|
| `pageView.breadcrumb` | Breadcrumb *(ours)* |
| `pageView.actions` | Page actions *(ours)* |
| `pageView.byline.requirements` | Requirements *(ours — the ⛹ byline icon, `RD-059`)* |
| `pageView.version.banner` | You are viewing an old version of this page (v. {n}). *(ours, `RD-060`)* |
| `pageView.version.current` | Back to the current version *(ours, `RD-060`)* |
| `pageView.draft.notice` | You have unpublished changes to this page. *(ours, `RD-055`)* |
| `pageView.draft.continue` | Continue editing *(ours, `RD-055`)* |
| `pageView.draft.discard` | Discard draft *(ours, `RD-055`)* |
| `pageView.draft.discard.title` | Discard your unpublished changes? *(ours)* |
| `pageView.draft.discard.body` | Your draft of this page will be deleted. The published version does not change. *(ours)* |
| `pageView.draft.discard.confirm` | Discard *(ours)* |
| `pageView.draft.discard.cancel` | Keep draft *(ours)* |
| `pageView.draft.discard.failed` | Couldn't discard your draft. Try again. *(ours)* |
| `pageView.favourite.failed` | Couldn't update Save for later. Try again. *(ours)* |
| `pageView.watch.failed` | Couldn't update Watching. Try again. *(ours)* |
| `pageView.error` | Couldn't load this page. *(ours)* |
| `pageView.error.retry` | Try again *(ours)* |
| `pageView.loading` | Loading the page… *(ours)* |
| `pageView.editTitle` | Editing {title} *(ours — the editor's window title)* |
| `pageShare.copied` | Link copied *(ours, `RD-061`)* |
| `pageShare.failed` | Couldn't copy the link. Copy it from the address bar. *(ours)* |
| `pageMenu.label` | More actions *(ours — the `···` button)* |
| `pageMenu.attachments` | Attachments |
| `pageMenu.history` | Page History |
| `pageMenu.restrictions` | Restrictions |
| `pageMenu.peopleWhoCanView` | People who can view |
| `pageMenu.info` | Page information |
| `pageMenu.hierarchy` | View in Hierarchy |
| `pageMenu.exportWord` | Export to Word |
| `pageMenu.reqforge` | Reqforge *(video: "Requirement Yogi" — our product name, `RD-031`)* |
| `pageMenu.copy` / `.move` / `.delete` | Copy / Move / Delete |
| `create.failed` | Couldn't create a page. Try again. *(ours, `RD-056`)* |
| `create.failed.forbidden` | You can't create pages in this space. *(ours)* |
| `create.failed.notFound` | We couldn't find that space. *(ours)* |
| `create.dismiss` | Dismiss *(ours)* |
| `pageView.dialog.close` | Close *(ours — the `···` menu's dialogs, `RD-059`)* |
| `pageView.dialog.cancel` | Cancel *(ours)* |
| `pageView.dialog.signedOut` | You've been signed out. Sign in again in another tab, then try again. *(ours)* |
| `pageView.dialog.gone` | This page no longer exists. *(ours, `RD-051`: a page you can no longer see reads the same)* |
| `pageAttachments.title` | Attachments *(ours — the dialog behind 📎 and `···` → Attachments, `RD-059`)* |
| `pageAttachments.loading` | Loading attachments… *(ours)* |
| `pageAttachments.loadFailed` | Couldn't load the attachments. *(ours)* |
| `pageAttachments.retry` | Try again *(ours)* |
| `pageAttachments.empty` | This page has no attachments. *(ours)* |
| `pageAttachments.table` | Attachments of {title} *(ours — the accessible name of the list)* |
| `pageAttachments.col.name` / `.size` / `.uploadedBy` / `.uploaded` / `.actions` | Name / Size / Uploaded by / Uploaded / Actions *(ours)* |
| `pageAttachments.size.bytes` / `.kib` / `.mib` | {n} B / {n} KiB / {n} MiB *(ours)* |
| `pageAttachments.upload` | Upload a file *(ours, `RD-058`)* |
| `pageAttachments.upload.help` | Images (PNG, JPEG, GIF or WebP) and other files, at most {mib} MiB each. SVG images are not allowed. *(ours, `RD-058`, `RD-071`)* |
| `pageAttachments.uploading` | Uploading "{name}"… *(ours)* |
| `pageAttachments.uploaded` | "{name}" was attached. *(ours)* |
| `pageAttachments.upload.empty` | "{name}" is empty, so it was not attached. *(ours, `RD-071`)* |
| `pageAttachments.upload.tooLarge` | "{name}" is too large to attach. A file can be at most {mib} MiB. *(ours, `RD-058`)* |
| `pageAttachments.upload.unsupported` | "{name}" can't be attached: SVG images are not allowed. *(ours, `RD-058`, `RD-071`)* |
| `pageAttachments.upload.forbidden` | You can't add files to this page. *(ours)* |
| `pageAttachments.upload.failed` | Couldn't attach "{name}". Try again. *(ours)* |
| `pageAttachments.hide` | Hide *(ours, `RD-058`: deleting an attachment hides it)* |
| `pageAttachments.hide.label` | Hide {name} *(ours — the accessible name of a row's Hide)* |
| `pageAttachments.hide.title` | Hide "{name}"? *(ours)* |
| `pageAttachments.hide.body` | It will no longer be listed with this page's attachments. The file itself is kept, so versions of the page that show it still do. *(ours, `RD-058`)* |
| `pageAttachments.hidden` | "{name}" was hidden. *(ours)* |
| `pageAttachments.hide.forbidden` | You can't hide files on this page. *(ours)* |
| `pageAttachments.hide.gone` | "{name}" is no longer attached to this page. The list has been refreshed. *(ours)* |
| `pageAttachments.hide.failed` | Couldn't hide "{name}". Try again. *(ours)* |
| `pageInfo.title` | Page information *(ours — the dialog's heading, after the `···` item)* |
| `pageInfo.pageTitle` / `.id` / `.space` / `.createdBy` / `.created` / `.lastModifiedBy` / `.lastModified` / `.version` / `.watching` | Title / Page ID / Space / Created by / Created / Last modified by / Last modified / Current version / Watching *(ours)* |
| `pageInfo.spaceValue` | {name} ({key}) *(ours)* |
| `pageInfo.versionValue` | v. {n} *(ours — links to Page History, §23)* |
| `pageInfo.watching.yes` / `.no` | Yes / No *(ours, `RD-061`)* |
| `pageCopy.title` | Copy "{title}" *(ours, `RD-056`)* |
| `pageCopy.body` | Only this page is copied, not its child pages. The copy starts from the current version and is placed last among this page's siblings. Images on the page are copied with it; other attachments are not. *(ours, `RD-056`, `RD-074`)* |
| `pageCopy.field` | Title of the copy *(ours)* |
| `pageCopy.field.empty` | Give the copy a title. *(ours, `RD-067`)* |
| `pageCopy.field.invalid` | This title can't be used. Use at most {max} characters, with no line breaks or control characters. *(ours, `RD-067`)* |
| `pageCopy.field.taken` | Another page in this space already has this title. *(ours, `RD-056`)* |
| `pageCopy.submit` | Copy *(ours)* |
| `pageCopy.busy` | Copying the page… *(ours)* |
| `pageCopy.tooLarge` | This page can't be copied: the images on it total more than {mib} MiB, the most one copy can carry. *(ours, `RD-074`)* |
| `pageCopy.tooLarge.unknown` | This page can't be copied: the images on it are too large to copy together. *(ours, `RD-074`)* |
| `pageCopy.forbidden` | You can't copy pages in this space. *(ours)* |
| `pageCopy.failed` | Couldn't copy the page. Try again. *(ours)* |
| `pageMove.title` | Move "{title}" *(ours, `RD-056`)* |
| `pageMove.body` | Choose its new place in {space}. Its child pages move with it, and it is placed last among its new siblings. *(ours, `RD-056`)* |
| `pageMove.filter` | Find a page *(ours — the filter field's label)* |
| `pageMove.list` | New parent page *(ours — the accessible name of the list)* |
| `pageMove.root` | At the top level *(ours — the space's root, `RD-056`)* |
| `pageMove.currentTag` | Current *(ours — marks where the page is now)* |
| `pageMove.none` | No page matches "{q}". *(ours)* |
| `pageMove.choice.root` | It will move to the top level of {space}. *(ours)* |
| `pageMove.choice.under` | It will move under "{parent}". *(ours)* |
| `pageMove.choice.same` | The page is already here. Choose another place. *(ours)* |
| `pageMove.submit` | Move *(ours)* |
| `pageMove.busy` | Moving the page… *(ours)* |
| `pageMove.cycle` | A page can't be moved under itself or under one of its own child pages. *(ours, `RD-056`)* |
| `pageMove.invalid` | The page can't be moved there: the page tree would be too deep, or that parent page no longer exists. *(ours, `RD-070`)* |
| `pageMove.forbidden` | You can't move pages in this space. *(ours)* |
| `pageMove.failed` | Couldn't move the page. Try again. *(ours)* |
| `pageMove.loading` | Loading the page tree… *(ours — the list is the live tree the sidebar shows)* |
| `pageMove.loadFailed` | Couldn't load the page tree, so the page can't be moved yet. Close this dialog and try again. *(ours)* |
| `pageDelete.title` | Delete "{title}"? *(ours, `RD-056`)* |
| `pageDelete.body.leaf` | This page will be deleted. *(ours, `RD-056`)* |
| `pageDelete.body.oneChild` | This page and the page under it will be deleted: 2 pages in all. *(ours, `RD-056`)* |
| `pageDelete.body.children` | This page and the {d} pages under it will be deleted: {n} pages in all. *(ours, `RD-056`: the confirmation names how many pages will go)* |
| `pageDelete.confirm` | Delete *(ours)* |
| `pageDelete.busy` | Deleting the page… *(ours)* |
| `pageDelete.forbidden` | You can't delete pages in this space. *(ours)* |
| `pageDelete.failed` | Couldn't delete the page. Try again. *(ours)* |
| `pageDelete.counting` | Counting the pages that will be deleted… *(ours, `RD-056`: the count is read afresh when the dialog opens)* |
| `pageDelete.countFailed` | Couldn't count the pages that would be deleted, so nothing can be deleted yet. Close this dialog and try again. *(ours, `RD-056`)* |

### 13.3 Editor toolbar, menus and dialogs (slice 1)

Owner: the editor agents. Read `RD-055` and `RD-057` first. Toolbar labels are the accessible
names of the glyphs `10` §5.1 draws (the video shows no text for them), read as `RD-057` reads
them. Colour names belong to the fixed palettes, seeded from the §1.1 tokens.

| Id | String |
|---|---|
| `editor.toolbar` | Editor toolbar *(ours)* |
| `editor.tableToolbar` | Table tools *(ours)* |
| `editor.style.label` | Text style *(ours)* |
| `editor.style.paragraph` | Paragraph |
| `editor.style.normal` | Normal |
| `editor.style.heading` | Heading {level} |
| `editor.style.quote` | Quote |
| `editor.style.preformatted` | Preformatted |
| `editor.bold` | Bold *(ours)* |
| `editor.italic` | Italic *(ours)* |
| `editor.underline` | Underline *(ours)* |
| `editor.textColour` | Text colour *(ours, `RD-057`)* |
| `editor.textColour.default` | Default colour *(ours)* |
| `editor.colour.grey` | Grey *(ours)* |
| `editor.colour.darkBlue` | Dark blue *(ours)* |
| `editor.colour.blue` | Blue *(ours)* |
| `editor.colour.green` | Green *(ours)* |
| `editor.colour.orange` | Orange *(ours)* |
| `editor.colour.red` | Red *(ours)* |
| `editor.colour.purple` | Purple *(ours)* |
| `editor.moreFormatting` | More formatting *(ours, `RD-057`)* |
| `editor.strike` | Strikethrough *(ours)* |
| `editor.subscript` | Subscript *(ours)* |
| `editor.superscript` | Superscript *(ours)* |
| `editor.code` | Code *(ours)* |
| `editor.clearFormatting` | Clear formatting *(ours)* |
| `editor.bulletList` | Bullet list *(ours)* |
| `editor.orderedList` | Numbered list *(ours)* |
| `editor.taskList` | Task list |
| `editor.outdent` | Outdent *(ours)* |
| `editor.indent` | Indent *(ours)* |
| `editor.alignLeft` | Align left *(ours, `RD-057`)* |
| `editor.alignRight` | Align right *(ours, `RD-057`)* |
| `editor.alignCentre` | Align centre *(ours, `RD-057`)* |
| `editor.infoPanel` | Info panel *(ours, `RD-057`)* |
| `editor.files` | Files and images |
| `editor.link` | Link |
| `editor.table` | Insert table *(ours)* |
| `editor.table.size` | {cols} × {rows} *(ours)* |
| `editor.table.sizeLabel` | Insert a table with {cols} columns and {rows} rows *(ours)* |
| `editor.emoji` | Emoji *(ours)* |
| `editor.insertMore` | Insert more content *(ours)* |
| `editor.find` | Find and replace *(ours, `RD-057`)* |
| `editor.help` | Keyboard shortcuts *(ours, `RD-057`)* |
| `editor.undo` | Undo *(ours)* |
| `editor.redo` | Redo *(ours)* |
| `editor.table.widthMode` | Table width *(ours)* |
| `editor.table.responsive` | Responsive |
| `editor.table.fixed` | Fixed width |
| `editor.table.rowAbove` | Insert row above *(ours)* |
| `editor.table.rowBelow` | Insert row below *(ours)* |
| `editor.table.deleteRow` | Delete row *(ours)* |
| `editor.table.columnBefore` | Insert column before *(ours)* |
| `editor.table.columnAfter` | Insert column after *(ours)* |
| `editor.table.deleteColumn` | Delete column *(ours)* |
| `editor.table.merge` | Merge cells *(ours)* |
| `editor.table.split` | Split cell *(ours)* |
| `editor.table.headerRow` | Header row *(ours)* |
| `editor.table.headerColumn` | Header column *(ours)* |
| `editor.table.numbered` | Numbered column *(ours, `RD-057`)* |
| `editor.table.fill` | Cell background *(ours, `RD-057`)* |
| `editor.table.noFill` | No fill *(ours)* |
| `editor.fill.grey` | Light grey *(ours)* |
| `editor.fill.blue` | Light blue *(ours)* |
| `editor.fill.green` | Light green *(ours)* |
| `editor.fill.yellow` | Light yellow *(ours)* |
| `editor.fill.red` | Light red *(ours)* |
| `editor.fill.purple` | Light purple *(ours)* |
| `editor.table.delete` | Delete table *(ours)* |
| `editor.breadcrumb` | Breadcrumb *(ours)* |
| `editor.labels` | Labels *(ours)* |
| `editor.title.label` | Page title *(ours)* |
| `editor.title.placeholder` | Give this page a title *(ours)* |
| `editor.title.empty` | Give this page a title before you publish it. *(ours)* |
| `editor.title.taken` | Another page in this space already has this title. *(ours, `RD-056`)* |
| `editor.title.invalid` | This title can't be used. Use at most 255 characters, with no line breaks or control characters. *(ours, `RD-067`)* |
| `editor.content.label` | Page content *(ours)* |
| `editor.placeholder` | Type your content here *(ours)* |
| `editor.presence` | Also editing this page *(ours, `RD-062`)* |
| `editor.presence.user` | {name} is editing this page *(ours, `RD-062`)* |
| `editor.presence.invite` | Invite collaborator *(ours)* |
| `editor.presence.more` | +{n} *(ours, `RD-062`)* |
| `editor.presence.moreLabel` | {n} more people are editing this page *(ours, `RD-062`)* |
| `editor.more` | More actions *(ours)* |
| `editor.more.revert` | Revert to last published |
| `editor.more.history` | Page history |
| `editor.save.retrying` | Couldn't save your changes. Trying again… *(ours, `RD-055`)* |
| `editor.save.signedOut` | You've been signed out. Sign in again in another tab and your changes will be saved. *(ours)* |
| `editor.save.noAccess` | You can no longer edit this page, so your changes can't be saved. *(ours)* |
| `editor.save.invalid` | Your changes can't be saved because some of the content isn't valid. *(ours, `RD-063`)* |
| `editor.save.tooLarge` | This page is too large to save. The limit is {mib} MiB. *(ours, `RD-063`)* |
| `editor.save.failed` | Couldn't save your changes. *(ours)* |
| `editor.publish.signedOut` | You've been signed out. Sign in again in another tab, then press Update. *(ours)* |
| `editor.publish.noAccess` | You can no longer edit this page. *(ours)* |
| `editor.publish.invalid` | This page can't be published because some of the content isn't valid. *(ours, `RD-063`)* |
| `editor.publish.messageInvalid` | Keep the change note to 500 characters or fewer. *(ours, `RD-063`)* |
| `editor.publish.tooLarge` | This page is too large to publish. The limit is {mib} MiB. *(ours, `RD-063`)* |
| `editor.publish.failed` | Couldn't publish this page. Try again. *(ours)* |
| `editor.conflict.message` | Someone published version {n} of this page while you were editing. *(ours, `RD-055`)* |
| `editor.conflict.help` | Overwrite publishes your changes as a new version on top of it. Reload latest discards your changes and opens the current version. *(ours, `RD-055`)* |
| `editor.conflict.overwrite` | Overwrite *(`RD-055`)* |
| `editor.conflict.reload` | Reload latest *(`RD-055`)* |
| `editor.revert.title` | Revert to last published? *(ours)* |
| `editor.revert.body` | This discards your unpublished changes and opens the current version of the page. *(ours, `RD-055`)* |
| `editor.revert.confirm` | Revert *(ours)* |
| `editor.revert.failed` | Couldn't revert to the last published version. Try again. *(ours)* |
| `editor.reload.failed` | Couldn't load the latest version. Try again. *(ours)* |
| `editor.cancel` | Cancel *(ours)* |
| `editor.closeUnsaved.title` | Close without saving? *(ours)* |
| `editor.closeUnsaved.body` | Your latest changes couldn't be saved. If you close the editor now, they will be lost. *(ours)* |
| `editor.closeUnsaved.confirm` | Close anyway *(ours)* |
| `editor.closeUnsaved.cancel` | Keep editing *(ours)* |
| `editor.linkDialog.title` | Insert link *(ours)* |
| `editor.linkDialog.editTitle` | Edit link *(ours)* |
| `editor.linkDialog.url` | Link address *(ours)* |
| `editor.linkDialog.urlHelp` | Starts with http://, https://, mailto:, tel: or a / for a page of this site. *(ours, `RD-063`)* |
| `editor.linkDialog.text` | Text to display *(ours)* |
| `editor.linkDialog.textHelp` | Optional. Leave it empty to link the selected text, or the address itself. *(ours)* |
| `editor.linkDialog.invalid` | Enter an address that starts with http://, https://, mailto:, tel: or a /. *(ours, `RD-063`)* |
| `editor.linkDialog.submit` | Insert *(ours)* |
| `editor.linkDialog.save` | Save *(ours)* |
| `editor.linkDialog.remove` | Remove link *(ours)* |
| `editor.insert.markup` | Markup |
| `editor.insert.horizontalRule` | Horizontal rule |
| `editor.insert.date` | Date |
| `editor.insert.symbol` | Symbol |
| `editor.insert.mention` | User mention |
| `editor.insert.externalIssue` | External issue *(ours, `RD-031`: the video's "Jira Issue/Filter", relabelled; later)* |
| `editor.macro.info` | Info |
| `editor.macro.status` | Status |
| `editor.macro.gallery` | Gallery |
| `editor.macro.toc` | Table of Contents |
| `editor.macro.requirement` | Requirement |
| `editor.macro.requirementReport` | Requirement report |
| `editor.macro.traceabilityMatrix` | Traceability matrix |
| `editor.macro.baseline` | Baseline |
| `editor.macroBrowser.title` | Macro browser *(ours)* |
| `editor.macroBrowser.search` | Search macros *(ours)* |
| `editor.macroBrowser.list` | Macros *(ours)* |
| `editor.macroBrowser.none` | No macro is called "{q}". *(ours)* |
| `editor.dialog.insert` | Insert *(ours)* |
| `editor.dialog.done` | Done *(ours)* |
| `editor.dialog.close` | Close *(ours)* |
| `editor.files.choose` | Choose files to attach *(ours, `RD-058`)* |
| `editor.upload.region` | File uploads *(ours)* |
| `editor.upload.uploading` | Uploading "{name}"… *(ours)* |
| `editor.upload.tooLarge` | "{name}" is too large to attach. A file can be at most {mib} MiB. *(ours, `RD-058`)* |
| `editor.upload.unsupported` | "{name}" can't be attached: this type of file is not allowed. *(ours, `RD-058`, `RD-071`)* |
| `editor.upload.empty` | "{name}" is empty, so it was not attached. *(ours, `RD-071`)* |
| `editor.upload.signedOut` | You've been signed out. Sign in again in another tab, then attach "{name}" again. *(ours)* |
| `editor.upload.noAccess` | You can no longer add files to this page. *(ours)* |
| `editor.upload.failed` | Couldn't attach "{name}". Try again. *(ours)* |
| `editor.upload.dismiss` | Dismiss *(ours)* |
| `editor.markup.title` | Insert markup *(ours)* |
| `editor.markup.format` | Format *(ours)* |
| `editor.markup.markdown` | Markdown *(ours)* |
| `editor.markup.html` | HTML *(ours)* |
| `editor.markup.input` | Markdown or HTML to insert *(ours)* |
| `editor.markup.help` | It is converted to page content. Images from other sites are left out. *(ours, `RD-058`)* |
| `editor.markup.empty` | Nothing in this markup can go on the page. *(ours)* |
| `editor.date.title` | Insert a date *(ours)* |
| `editor.date.editTitle` | Edit date *(ours)* |
| `editor.date.invalid` | Enter a real date. *(ours, `RD-068`)* |
| `editor.status.title` | Edit status *(ours)* |
| `editor.status.text` | Text *(ours)* |
| `editor.status.colour` | Colour *(ours)* |
| `editor.status.defaultText` | Status *(ours)* |
| `editor.status.invalid` | Enter 1 to 60 characters. *(ours, `RD-068`)* |
| `editor.colour.yellow` | Yellow *(ours)* |
| `editor.symbol.title` | Insert a symbol *(ours)* |
| `editor.mention.title` | Mention someone *(ours)* |
| `editor.mention.search` | Name *(ours)* |
| `editor.mention.results` | People *(ours)* |
| `editor.mention.searching` | Searching… *(ours)* |
| `editor.mention.none` | No one's name starts with "{q}". *(ours)* |
| `editor.mention.failed` | Couldn't search for people. Try again. *(ours)* |
| `editor.panel.type` | Panel type *(ours)* |
| `editor.panel.info` / `.note` / `.success` / `.warning` / `.error` | Info / Note / Success / Warning / Error *(ours)* |
| `editor.toc.empty` | Add headings to this page to fill the table of contents. *(ours)* |
| `editor.find.query` | Find *(ours)* |
| `editor.find.replacement` | Replace with *(ours)* |
| `editor.find.matchCase` | Match case *(ours)* |
| `editor.find.previous` | Previous match *(ours)* |
| `editor.find.next` | Next match *(ours)* |
| `editor.find.replace` | Replace *(ours)* |
| `editor.find.replaceAll` | Replace all *(ours)* |
| `editor.find.close` | Close find and replace *(ours)* |
| `editor.find.count` | {current} of {total} *(ours)* |
| `editor.find.capped` | {current} of more than {total} *(ours)* |
| `editor.find.none` | No results *(ours)* |
| `editor.shortcuts.action` | Action *(ours)* |
| `editor.shortcuts.keys` | Keys *(ours)* |
| `editor.shortcuts.group.formatting` | Text formatting *(ours)* |
| `editor.shortcuts.group.paragraph` | Paragraphs and lists *(ours)* |
| `editor.shortcuts.group.editing` | Editing *(ours)* |
| `editor.shortcuts.group.insert` | Insert and find *(ours)* |
| `editor.shortcuts.save` | Save your changes as a draft now *(ours, `RD-055`)* |
| `editor.shortcuts.editNode` | Edit the selected status or date *(ours)* |
| `editor.shortcuts.lineBreak` | Line break *(ours)* |
| `editor.key.ctrl` / `.alt` / `.shift` / `.enter` / `.tab` | Ctrl / Alt / Shift / Enter / Tab *(ours)* |
| `editor.key.macCmd` / `.macOption` / `.macShift` | ⌘ / ⌥ / ⇧ *(ours)* |

### 13.4 Page tree, space overview, Page history and compare (slice 1)

Owner: the tree and history agent. Read `RD-056` and `RD-060` first.

| Id | String |
|---|---|
| `tree.label` | Page tree *(ours — the accessible name of the sidebar's tree)* |
| `tree.keyboardHelp` | Enter opens a page. Alt + Up Arrow and Alt + Down Arrow move it among its siblings, Alt + Shift + Right Arrow moves it under the page above it, and Alt + Shift + Left Arrow moves it up a level. *(ours — the keyboard route for "drag to reorder and re-parent", §3.2)* |
| `tree.loading` | Loading pages… *(ours)* |
| `tree.error` | Couldn't load the page tree. *(ours)* |
| `tree.retry` | Try again *(ours)* |
| `tree.createChild` | Create a page under "{title}" *(ours, `RD-056`)* |
| `tree.createPage` | Create a page *(ours, `RD-056`)* |
| `tree.create.failed` | Couldn't create the page. Try again. *(ours)* |
| `tree.create.forbidden` | You can't create pages in this space. *(ours)* |
| `tree.create.parentGone` | That page no longer exists, so no page was created under it. *(ours)* |
| `tree.move.cycle` | A page can't be moved under itself or under one of its own child pages. The move was undone. *(ours, `RD-056`)* |
| `tree.move.invalid` | The page can't be moved there: the page tree would be too deep, or the new parent page no longer exists. The move was undone. *(ours, `RD-070`)* |
| `tree.move.forbidden` | You can't move pages in this space. The move was undone. *(ours)* |
| `tree.move.notFound` | That page no longer exists. The page tree has been refreshed. *(ours)* |
| `tree.move.failed` | Couldn't move the page, so the move was undone. Try again. *(ours)* |
| `tree.signedOut` | You've been signed out. Sign in again in another tab, then try again. *(ours)* |
| `tree.moved.root` | "{title}" moved to the top level, position {position} of {count}. *(ours)* |
| `tree.moved.under` | "{title}" moved under "{parent}", position {position} of {count}. *(ours)* |
| `tree.alert.dismiss` | Dismiss *(ours)* |
| `overview.tree` | Pages in {space} *(ours — the accessible name of the space overview's tree, §11)* |
| `history.col.version` / `.published` / `.changedBy` / `.comment` / `.actions` | Version / Published / Changed By / Comment / Actions *(§23's column headings: `history.col` above, one id per column)* |
| `history.version` | v. {n} *(§23: the label of every row but the current one)* |
| `history.pinned` | Pinned by baseline {n} *(§23: the disabled Delete's tooltip)* |
| `history.pinned.unknown` | Pinned by a baseline *(ours — until baselines ship (slice 13) the API does not say which baseline pins a version)* |
| `history.windowTitle` | Page History – {title} *(ours — the browser tab's title)* |
| `history.breadcrumb` | Breadcrumb *(ours)* |
| `history.table` | Versions of {title} *(ours — the accessible name of the history table)* |
| `history.col.select` | Select *(ours — the accessible name of the checkbox column)* |
| `history.select` | Select v. {n} to compare *(ours)* |
| `history.compare.hint` | Select exactly two versions to compare. {n} selected. *(ours — why Compare selected versions is unavailable)* |
| `history.compare.ready` | Compares v. {a} with v. {b}. *(ours)* |
| `history.restore.label` | Restore v. {n} *(ours — the accessible name of a row's Restore)* |
| `history.delete.label` | Delete v. {n} *(ours — the accessible name of a row's Delete)* |
| `history.restore.title` | Restore v. {n}? *(ours)* |
| `history.restore.body` | This publishes the title and content of v. {n} as a new current version, with the comment "Restored from v. {n}". Every version stays in the history. *(ours, `RD-060`)* |
| `history.delete.title` | Delete v. {n}? *(ours)* |
| `history.delete.body` | v. {n} will be removed from the page history for everyone. This can't be undone. *(ours, `RD-060`)* |
| `history.cancel` | Cancel *(ours)* |
| `history.restoring` | Restoring v. {n}… *(ours)* |
| `history.deleting` | Deleting v. {n}… *(ours)* |
| `history.deleted` | v. {n} was deleted. *(ours)* |
| `history.restore.failed` | Couldn't restore v. {n}. Try again. *(ours)* |
| `history.restore.forbidden` | You can't restore versions of this page. *(ours, `RD-060`)* |
| `history.restore.titleTaken` | v. {n} can't be restored: another page in this space now has its title. *(ours, `RD-056`)* |
| `history.delete.failed` | Couldn't delete v. {n}. Try again. *(ours)* |
| `history.delete.forbidden` | You can't delete versions of this page. *(ours, `RD-060`)* |
| `history.delete.current` | v. {n} is the current version, so it can't be deleted. *(ours, `RD-060`)* |
| `history.delete.pinned` | v. {n} is pinned by a baseline, so it can't be deleted. *(ours, `RD-060`)* |
| `history.gone` | v. {n} no longer exists. The page history has been refreshed. *(ours)* |
| `history.signedOut` | You've been signed out. Sign in again in another tab, then try again. *(ours)* |
| `history.dismiss` | Dismiss *(ours)* |
| `history.loading` | Loading the page history… *(ours)* |
| `history.error` | Couldn't load the page history. *(ours)* |
| `history.error.retry` | Try again *(ours)* |
| `compare.title` | Compare v. {a} with v. {b} *(ours, `RD-060`)* |
| `compare.windowTitle` | Compare v. {a} with v. {b} – {title} *(ours — the browser tab's title)* |
| `compare.back` | Back to Page History *(ours)* |
| `compare.table` | Changes from v. {a} to v. {b} *(ours — the accessible name of the side-by-side table)* |
| `compare.titleChanged` | Title changed *(ours, `RD-060`)* |
| `compare.summary` | {added} added, {removed} removed, {changed} changed *(ours)* |
| `compare.identical` | v. {a} and v. {b} have the same content. *(ours)* |
| `compare.approximate` | These versions are too different to line up exactly, so some unchanged blocks may show as changed, added or removed. *(ours, `RD-066`)* |
| `compare.status.added` / `.removed` / `.changed` / `.same` | Added / Removed / Changed / Unchanged *(ours, `RD-060`)* |
| `compare.missing` | Not in v. {n} *(ours — the empty side of an added or removed block)* |
| `compare.empty` | This version has no content. *(ours)* |
| `compare.loading` | Loading the comparison… *(ours)* |
| `compare.error` | Couldn't compare these versions. *(ours)* |

### 13.5 Server-side messages (slice 1)

Owner: the server agent. Strings the server itself writes into stored data: the titles it makes
up for new and copied pages, and the change notes it stores on versions. Problem-detail titles
and details are API text, not interface copy: clients branch on the problem's `code` (`08`
§3.2) and show their own copy-deck strings, so those live in a table in
`src/app/api/v1/_lib/problem.ts`.

| Id | String |
|---|---|
| `page.untitled` | Untitled *(ours, `RD-056`)* |
| `page.copyOf` | Copy of {title} *(ours, `RD-056`)* |
| `history.restoredNote` | Restored from v. {n} *(ours, `RD-060`)* |
| `history.renamedNote` | Renamed from "{old}" *(ours, `RD-056`)* |

---

## 14. Baselines tab

Heading `Baselines`. Evidence: videos-2 §2.1.

```
 Baselines
 Search  Coverage  Dependencies  Traceability  [Baselines]  Diff  Reports  External properties    ⚙ ?

 Baselines save a frozen snapshot of your requirements at a certain point of time.
   • That's useful when you raise an issue about a specific version of your requirements.
   • You can also create a baseline from the search screen with a subset of your requirements.

 [Generate diff]  [Create a new baseline]

 [Search for a baseline      ] [Search]          4 baselines [100 ▾]  << First  < Prev  1/1  Next >  Last >>

 ID   Name                                           Page Count  Count             Status  Actions
 ☐ 4  Baseline 4 for Requirements from Stakeholders  1 page      7 requirements    DONE    [Rename] [Refreeze] [Delete]
 ☐ 3  Baseline 3                                     1 page      8 requirements    DONE    [Rename] [Refreeze] [Delete]
```

| Element | Rule |
|---|---|
| Row checkbox | select **one** baseline → `Generate diff` compares it with current requirements; select **two** → compares them with each other; more than two disables the button |
| `ID` | the baseline number (`05` §4) |
| `Page Count` | link — lists the pages whose versions this baseline pinned |
| `Count` | link — opens Search with `baseline = N` |
| `Status` | `DONE` (green) for a frozen baseline. A draft shows **`DRAFT`** in grey — no draft appears in the videos, so the label is ours (videos-2 §7) |
| `Rename` | inline rename; the number never changes |
| `Refreeze` | opens the wizard on this baseline with its stored scope (`05` §3.4) |
| `Delete` | allowed by the baseline-deletion permission (`07` §2.4); confirmation names the baseline and its requirement count |
| Pager | `{n} baselines`, page size `100 ▾`, `<< First  < Prev  1/1  Next >  Last >>` |

## 15. Creating a baseline

### 15.1 The wizard

Heading `Create a baseline`. A progress bar over four step labels — **Search · Baseline
options · Dependencies · Create**. Evidence: videos-2 §2.3.

**Step 1 — Search.**

```
 Name   [ Baseline 5                          ]
        Define a name for this baseline

 Choose requirements
 Which requirements do you want to use?
 Scope  ◉ Reuse the selected requirements: key IN ('TECH-005', 'TECH-006')
        ○ Reuse the searched requirements: key ~ 'TECH-%'
        ○ All requirements in this space

 Links
 As people keep updating the requirements after this baseline:
   • The text and properties of the "frozen" requirements won't change.
   • It is possible to link to a specific version: In the editor, either paste a URL
     directly, or click on the macro and choose the version number.

 This action will create a page with a summary of the baseline.
                                                           Cancel  [Next]
```

- `Name` defaults to `Baseline {next number}`.
- The **Scope** block appears only when the wizard was opened from the Search tab with a
  selection. From the Baselines tab the scope is the whole space and the block is
  replaced by an optional query field.
- *This action will create a page…* is shown only when step 2's *Baseline page* option is
  set to create one; the step updates when the option changes.

**Step 2 — Baseline options.**

```
 When           ◉ Freeze requirements now
                ○ Freeze requirements later
                  Freeze requirements later if you are anticipating on a future
                  baseline and you want to add details.

 Baseline page  ◉ None (simple)
                ○ Create a baseline and an associated page
                  The associated page will display the baseline details and a few
                  requirements. It is not compulsory to create a page, since the
                  details can be found in the list of baselines.

                [Create baseline]
```

Defaults **Freeze requirements now** and **None (simple)**, as shown.

**Step 3 — Dependencies.** Never shown in the videos. Ours, following the written docs
(research §5.2): if the selected requirements have parent dependencies outside the
selection, list them with a count and offer **Include parent requirements** (unchecked
by default). With no such parents, the step is skipped and its label greyed.

**Step 4 — Create.** Runs the freeze job (`05` §3) with the long-running-task view (§17.2),
then lands on the Baselines tab with the new row highlighted.

### 15.2 From the Search tab

Select requirements, `Actions ▾` → `Make Baseline`. The wizard opens with the Scope block
filled from the selection and the current query.

### 15.3 Instant baseline from a page

Byline product panel (§4.4) → `Create baseline from this page` or `and its descendents`.
The panel swaps to:

```
 < Back
 Create an instant baseline from this page
 [ Baseline 4 for Requirements from Stakeholders ]   [Create]
```

Name defaults to `Baseline {n} for {page title}`. No wizard, no page; freezes immediately.

## 16. Diff tab

Heading `Diff`. Evidence: videos-2 §2.7.

```
     First query: [ baseline = 1                                   ]
    Second query: [                                                ]
                  [Generate diff]  Display ▾  Compare ▾  Limit (600) ▾  ☐ Display descriptions      [Insert as a macro]

 baseline = 1                 State         Set 2
 BR-01 v1                     [MODIFIED]    BR-01
 BR-05 v1                     [REMOVED]     NON EXISTING
```

| Element | Rule |
|---|---|
| First / Second query | RQL; an empty second query means current requirements |
| Column headers | the first query's text, `State`, then the second query's text — or **`Set 2`** when it is empty |
| `Display ▾` | row filter: All · Added · Removed · Modified · Unchanged; default hides Unchanged |
| `Compare ▾` | checkboxes: **Description** (on) · **External properties** · **Dependencies** · **Issues** (later — needs integrations). Properties are always compared |
| `Limit (600) ▾` | 600 · 2000 · the global limit |
| `Display descriptions` | expands every row into side-by-side content |
| `Insert as a macro` | copies an embeddable diff block for a page |
| Keys | baselined keys carry their version: `BR-01 v1` |
| Absent side | `NON EXISTING` in red text |

With **Display descriptions** on, each row shows on both sides the description, the other
columns, the dependency badges and the external properties. **Removed text is red with
strikethrough; added content is highlighted green** — the video's legend: *"Green: what
has been added. Red: what has been removed."*

Opening Diff from the Baselines tab or the Search `Actions` menu pre-fills both queries.

## 17. Rename requirements

### 17.1 Rename page

A full page with the space sidebar, **not a dialog**. Evidence: videos-2 §4.5.

```
 Rename requirements
 ☐ Ignore integration errors
 Prefix              Middle           Suffix
 [ KEY-00        ]   [ 1 ]  (grey)    [ A          ]      ← only the first row is editable
 KEY-00              2                A
 KEY-00              3                A
 …
 [Rename]  Cancel
```

- Reached from Search: select requirements → `Actions ▾` → `Rename`.
- Each selected key is split into **Prefix · Middle · Suffix** (`03` §5). The first row's
  Prefix and Suffix are editable; Middle is shown greyed and fixed; every other row
  previews live.
- `Ignore integration errors` exists for phase-3 integrations and is hidden until one is
  configured.

### 17.2 Long-running task view

Shared by rename, reindex, freeze and imports:

```
 Rename requirements (long running task)
 Time Elapsed: 1 seconds
 Time Remaining: 0:00 (estimated)
 Completion: 100% complete
 ✓ Rename task finished successfully.
 Information:
   • Reqforge modified 14 macros on 2 pages to rename 7 requirements.
 [Stop and cancel this task]          ← while running
```

The task keeps running if the page is closed — unlike RY, whose reindex needs the page
open (`RD-046`). The view reattaches from `/jobs/{id}`.

## 18. Space settings — requirements

The space's `Space tools` → **Reqforge** tab, sub-tabs **Options · Reindex · Key
suggestions · Trash**. RY's fifth sub-tab, `Fix Jira links`, is later (integrations).
Evidence: videos-2 §4.4, §4.7.

### 18.1 Key suggestions

```
 Users generate new requirement keys in the editor. These options allow administrators
 to control which keys are generated.

 Settings
   ☑ Use global settings
       Default: Ticked. Inherit global settings for this space.
       If unticked, you can select the options below.
   ☑ Links across spaces                         ← the four below are disabled while
       Recommended: Ticked. …                       "Use global settings" is ticked
   ☐ Prevent reusing deleted keys
       Default: Unticked. …
   ☐ Generate global keys
       Default: Unticked. …
   ☐ Lock keys
       Default: Unticked. …
   [Save]

 Key Suggestions                       [200 items per page ▾]  First  Prev  1  Next  Last
 Prefix        Number       Suffix       Actions
 [        ]    [ 001    ]   [       ]    [Add]
 RFS-          007                       [Delete]  Search
 SPEC-         00255                     [Delete]  Search
```

| Element | Rule |
|---|---|
| Option help text | verbatim from the copy deck (`keys.*`) |
| `global settings` in the first help line | link to the Administration key-suggestion settings |
| Add row | `Number` pre-filled `001`; its width sets the padding |
| `Delete` | removes the suggestion; the next key for that prefix is recomputed from the highest existing key (`06` §1) |
| `Search` | opens Search with `key ~ '{prefix}%{suffix}'` |
| Number column | the **last used** number for the pattern, zero-padded |

### 18.2 Reindex

```
 Reindex the space
 If requirements are not up-to-date, this task will help you reindex the space.
 You will be able to interrupt the task at any moment without consequence.
 [Reindex]
```

While running, the long-running task view (§17.2), headed `Reindex space (long running
task)`, with the step note *"This task first searches for pages of the space (step 1:
5%), then resets the requirement definitions (step 2: 20%), then reindexes them (step 3:
75%)."*

### 18.3 Options and Trash

`Options` — space-level overrides of the requirement settings (isolation, history,
classification). `Trash` — requirements with status `DELETED`, each linking to its
deleted-requirement page (§22), with a purge action for space admins. Neither screen is
opened in the videos; both are ours.

## 19. Administration

Instance administration → **Reqforge**. Tabs in the video's order (videos-2 §4.6):

| Tab | Status | Content |
|---|---|---|
| Getting started | v1 | health checks: database, job runner, search index; *"Reqforge is properly installed."*; versions |
| **Options** | v1 | §19.1 |
| **Queue** | v1 | §21 |
| Integrations | later | GitHub, Jira, test tools |
| **Properties** | v1 | §19.2 |
| **Key suggestions** | v1 | the global defaults behind §18.1, same layout |
| Upgrade tasks | v1 | read-only list of applied schema migrations and data upgrades |
| Logging | later | |
| Support | later | |
| **Usage metrics** | v1 | §19.3 |
| Tutorials / checklist | later | |

### 19.1 Options

```
 Limits
   Global limit [ 12000 ]
                Default is 12 000. Maximum number of requirements that can be treated
                together at any time. Leave empty if unsure.
                ▸ Other limits   ▸ Traceability matrix limits   ▸ Popup options
                [Save]

 Permissions
   Requirements rename [                    ]
                       Comma-separated list of groups who are allowed to rename …
   Baseline deletion   [                    ]
                       Comma-separated list of groups who are allowed to delete baselines …
   Export              ☑ Allow export for anyone who can view requirements
                       Default: Ticked. …
                       [Save]
```

Help texts verbatim from the copy deck (`admin.*`). `Other limits` expands the limits in
`07` §4. RY's *Indexing engine* block has no equivalent and is not built; its
*Public descriptions* setting arrives with integrations.

### 19.2 Properties

```
 Changing the type of a property allows you to perform calculations in the Estimate tool.
 Properties are global: The type of a property is the same across all spaces, and if you
 press 'Remove', it will remove the values for this external property for the whole instance.

 [Search for a property ] [Search]    6 property names  [10 ▾]  << First  < Prev  1/1  Next >  Last >>
 Property name    Data type        INLINE   EXTERNAL   Actions
 Comments         Text             0        67         [Type ▾] [Remove]
 Estimate         Decimal number   0        7          [Type ▾] [Remove]
```

`INLINE` and `EXTERNAL` count values of that property name in each kind (`01` Property).
`Remove` confirms with the external value count and deletes the definition with every
value. There is **no rename** (`RD-040`).

### 19.3 Usage metrics

*"We don't do telemetry, these metrics are just for you."* Collapsible sections: Top 20
spaces · Most recent spaces · Most recent users · Usage statistics (1 year), the last a
monthly table `Date · BASELINES · REQUIREMENTS · TRACEABILITY`. Computed locally; nothing
leaves the installation.

## 20. Traceability tab

Heading `Requirements`. Evidence: videos-2 §4.2.

```
 Search: [                                        ] [⌕] [?]  [Save ▾] [···]
         Optional. A normal search query, see search syntax.
         Built in 151 ms.
 (●━)  Page size ▾ – 110 requirements – Show baselines – Cross-space – Export traceability matrix –  [Insert as a macro]

 Requirement [+ Add property]  │ Estimate     │ Estimate (Max)
 › BR-01                       │ [ 8.0     ]  │ [ 2        ]
   Business_requirement_001    │ [         ]  │ [          ]
```

| Element | Rule |
|---|---|
| `Search:` | RQL; empty means the whole space |
| `Save ▾` | Save · Save as… · Rename · Delete; saved views feed the sidebar (§9.5) |
| `···` | column presets, Reset columns |
| `Get data from Jira` | later — the checkbox slot under the help line is reserved |
| `Built in N ms.` | render time, always shown |
| Toggle `(●━)` | **edit mode** — green when on; external-property cells become inputs; changes save per cell |
| Toolbar line | `Page size ▾ – {n} requirements – Show baselines – Cross-space – Export traceability matrix –` then `Insert as a macro` |
| `+ Add property` | opens *Add external property column*: `Start typing to search…` over existing properties, or `Or create a new one` with `Type: Text ▾` |
| Row expander `›` | shown on rows with children; expands to the dependency tree |

## 21. Queue

Our job queue (`00` decision 4) shown the way RY shows its message queue (videos-2 §4.9).

```
 Delete all - Filter by status ▾ - Filter by queue ▾ - Filter by instance ▾   [Refresh]

 Statistics
 Queue        Last execution             NEW  RETRY  DONE  FAILED
 Indexing     30 minutes 29 seconds ago  0    0      753   44
 Baselines    2 hours ago                0    0      12    0
 Exports      …

 Messages                                                         0-50 out of 1212  Next >
 Message ID  Queue     Author  Contents                          Status   Actions
 › 1223      INDEXING  admin   Indexing of Specifications        DONE     Delete
 › 979       INDEXING  admin   Indexing of Page test again       FAILED   Delete - Retry
```

- Queues are our job kinds: Indexing, Baselines, Rename, Exports, Imports (later),
  Integrations (later).
- `›` expands a row to its parameters and error.
- `Retry` on failed jobs; `Delete` on finished ones; `Delete all` honours the filters.
- **Retention: the oldest finished jobs are deleted beyond 20,000** — RY's figure.
- **Personal queue** — an item in the user menu opening the same screen filtered to the
  user's own jobs, read-only for settings: *"Users can see their own queue, but will not
  be able to change the configuration."*

## 22. Deleted-requirement page

Opening a requirement whose status is `DELETED` (videos-2 §4.4):

```
 Requirement BR-01
 ┌ The requirement is DELETED. It used to be on the page Specifications.
 │ See below for the deleted requirement.
 └
 ┊ Details of BR-01                                                         ┊
 ┊   <last indexed content, properties, dependency badges and links>        ┊   ← dashed frame
```

Same body as the popup, framed with a dashed border. Links to the last page version that
contained it. This is the user-visible half of indexer contract I3.

## 23. Page history

`···` → `Page History` (videos-2 §2.8):

```
 Page History
 View, compare, or restore historical versions of this page. Older versions may be
 automatically deleted based on rules set by your administrator.
 [Compare selected versions]

 ☐  Version           Published           Changed By  Comment                                Actions
 ●  CURRENT (v. 234)  Jul 25, 2023 13:08  admin
 ☐  v. 233            Jul 25, 2023 12:50  admin                                              Restore  Delete
 ☐  v. 225            Jul 25, 2023 08:54  admin       Baseline "Baseline 3" for Reqforge     Restore  Delete (disabled)
```

- The **Comment** column shows the change note from the editor footer.
- **A version pinned by a baseline carries the comment `Baseline "<name>" for Reqforge`**
  and its `Delete` is disabled with the tooltip *"Pinned by baseline <n>"* (`05` §3.2,
  `RD-041`).
- `Compare selected versions` takes exactly two checked versions.

## 24. External properties tab

Heading `Requirements`. Evidence: videos-2 §4.1.

```
 External properties help you assign a value to requirements without editing the original
 page. They can be very useful for estimates or for the Excel loop with your customer.
    Upload Excel file [Choose file] No file chosen                  ← later (Excel loop)

 External properties                                                    [⚙] [Create new]
 0-6 out of 6
 Type       Key              Actions
 STRING     Comments         ✎
 FLOAT      Estimate         ✎
 DROPDOWN   Status           ✎
 0-6 out of 6
 Legacy Excel import — New Excel import                                ← later
```

- `Type` shows the type code: `STRING`, `FLOAT`, `INTEGER`, `BOOLEAN`, `DROPDOWN`.
- `Key` links to Search with `ext@<name> IS NOT NULL`.
- `✎` edits the definition's type and, for DROPDOWN, its values — shown to instance
  administrators only, because a definition is instance-wide (`07` §2.4). **Never its
  name.**
- `Create new` requires the space-admin permission, as in RY (research §2.6).
- `⚙` links to Administration → Properties.
- The Excel upload and the two Excel links keep their places in v1, rendered disabled
  with *"Available when Excel import ships"*, so the screen does not reflow later.

## 25. Excel import — recorded for phase 3

Not in v1. Recorded here so the phase-3 build follows the video without re-research.
Evidence: videos-2 §3.

- **Upload:** heading `{Space} - Excel`; table of Excel attachments (`Name · Version ·
  Creation Date · Last Modification Date · Labels · Attached To · Actions`); `New File
  Upload` with `File`, *"Upload an Excel file to parse it for requirements. Max 4000
  requirements per import."*, and `Attach To Page*`.
- **Configure:** banner *"Please complete the configuration. Requirements have not been
  imported yet."*; `Uploaded File` block with `Reupload` / `Cancel`; one block per sheet
  with `Import ? : Yes/No` and `Category`; a preview grid whose column headers are role
  dropdowns **`KEY` · `DESCRIPTION` · `PROPERTY` (+ name) · `-`**; `Import requirements`
  / `Delete`.
- **Result:** banner *"{n} requirements created. File processed in {ms}ms"*.
- Imported requirements are read-only, open the standard popup, and show the file as
  their origin in the Links column.
