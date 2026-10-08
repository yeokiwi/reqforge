# Requirement Yogi — screencast evidence, set 2

Three further vendor screencasts, supplied 2026-10-08 and stored in `docs/research/`
(git-ignored, local only):

| Id | File | Length | RY build |
|---|---|---|---|
| **VB** | `How to create baselines and compare requirement versions - Confluence Data Center - Requirement Yogi (1080p).mp4` | 4:20 | older — tabs end `… Diff · Estimates · Excel` |
| **VE** | `Import your requirements from Excel - Requirement Yogi Data Center - Requirement Yogi (1080p).mp4` | 3:00 | newer — tabs end `… Diff · Reports · External properties` |
| **VA** | `Tips & Tricks Administrate Requirement Yogi for Data Center - Requirement Yogi (1080p).mp4` | 4:47 | newer — as VE |

Method as before: one frame every 2 s, near-duplicates dropped, the rest OCR'd, and every
screen relied on below inspected at full resolution. Audio was not transcribable here.
Timestamps are `m:ss`. Any frame can be pulled with
`ffmpeg -ss <t> -i "<file>" -frames:v 1 out.png`.

This note ranks alongside `requirement-yogi-video.md` (set 1). Both outrank the prose
docs. Where set 1 and set 2 disagree, **the newer RY build wins** — §9.

---

## 1. Two product builds

The four videos show two RY builds, distinguishable by the Requirements tab bar:

| Build | Tab bar |
|---|---|
| Older (set 1; VB) | Search · Coverage · Dependencies · Traceability · Baselines · Diff · **Estimates** · **Excel** |
| Newer (VE, VA) | Search · Coverage · Dependencies · Traceability · Baselines · Diff · **Reports** · **External properties** |

The newer build matches the written docs' statement that the Estimates tab was renamed
External Properties. Excel import moved out of its own tab and into links at the foot of
the External properties tab (§4.1). VA shows that an administrator can still re-enable a
separate *Excel tab in the space nav* as an optional module.

Every Requirements-screen tab has a page heading above the tab bar — `Requirements`,
`Baselines`, `Diff`, `Create a baseline`, or the uploaded file's name.

---

## 2. Baselines (VB)

Agenda (0:04): *3 ways to create a baseline · Compare baselines · Tips and key
takeaways.* Framing slide: *"When you receive the specs from your customers, you will
want to keep track of versions. Baselines allow you to take a snapshot of requirements,
and compare them later on."*

### 2.1 Baselines tab (0:22, 2:42 — full resolution)

```
 Baselines
 Search  Coverage  Dependencies  Traceability  [Baselines]  Diff  Estimates  Excel      ⚙ ?

 Baselines save a frozen snapshot of your requirements at a certain point of time.
   • That's useful when you raise a Jira issue about a specific version of your requirements.
   • You can also create a baseline from the search screen with a subset of your requirements.

 [Generate diff]  [Create a new baseline]

 [Search for a baseline      ] [Search]          4 baselines [100 ▾]  << First  < Prev  1/1  Next >  Last >>

 ID   Name                                          Page Count   Count              Status   Actions
 ☐ 4  Baseline 4 for Requirements from Stakeholders  1 page       7 requirements     DONE     [Rename] [Refreeze] [Delete]
 ☐ 3  Baseline 3                                      1 page       8 requirements     DONE     [Rename] [Refreeze] [Delete]
 ☑ 2  Baseline 2                                      3 pages      30 requirements    DONE     [Rename] [Refreeze] [Delete]
 ☑ 1  Baseline 1                                      1 page       23 requirements    DONE     [Rename] [Refreeze] [Delete]
```

- `Page Count` and `Count` are links.
- Status badge `DONE` in green. No other status appears in the videos.
- Slide (2:42): *"Select one baseline to compare with the current requirements. Select two
  baselines to compare them with each other."* — then `Generate diff`.

### 2.2 Three ways to create a baseline

**1. For all requirements in the space** — Baselines tab → `Create a new baseline`.

**2. For specific requirements** — Search tab, select requirements, `Actions` →
`Make Baseline`. The search `Actions` menu (0:46) also lists `Create RY Test Session
procedure`, `Generate Diff` and `Bulk edit external property`.

**3. From a specific page** — click the product icon in the page byline (§5.1) →
`Create baseline from this page` (or `/ and its descendents`) → a panel
`< Back · Create an instant baseline from this page` with a name pre-filled
`Baseline 4 for <page title>`.

### 2.3 The Create-a-baseline wizard (0:24–0:28, 0:48–0:50)

Heading `Create a baseline`, a progress bar over four step labels:
**Search · Baseline options · Dependencies · Create**.

Step *Search*, when started from the Search tab:

```
 Name   [ Baseline 3                       ]
        Define a name for this baseline

 Choose requirements
 Which requirements do you want to use?
 Scope  ◉ Reuse the selected requirements: key ~ 'TECH-5…'
        ○ Reuse the searched requirements: key ~ 'TECH-%'
        ○ All requirements in this space

 Links
 As people keep updating the requirements after this baseline:
   • The text and properties of the "frozen" requirements won't change.
   • In Confluence, it is possible to link to a specific version: In the editor, either
     paste a URL directly, or click on the macro and choose the version number.

 This action will create a page with a summary of the baseline.
                                                     Cancel   [Next]
```

Step *Baseline options* (full resolution at 0:26):

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

Defaults: **Freeze now**, **None (simple)**. The *Dependencies* step is not shown.

### 2.4 Viewing baselined requirements (1:14–1:38)

- Search → `Show all versions`. The echo line becomes *"Requirements - all of them and
  in space 'TEAM' and with status 'ACTIVE' or with status 'ARCHIVED'"*; the pager link
  flips to **`Show current only`**; count rose from 80 to 98.
- **Baselined rows have a grey background.** Their keys read **`BR-01 v1`**, and their
  links read `FN-02 v1 (relates)`.
- Slide: *"You can only edit requirements in the Current version."*
- Popup on a baselined version: header **`BR-01 v1  v1 - Baseline 1  < >`**; footer link
  **`See all versions of this requirement`**. The `<` `>` arrows step between versions.

### 2.5 Linking to a baselined key (1:42–1:52)

Slide: *"Baselined requirements take the number of the baseline in the key, and in the
URL."* Copying a baselined requirement's URL and pasting it on a page creates a link to
that version. In the editor the chip reads `Requirement | Link | BR-01 | 1`, and clicking
it shows a popover: **`Transform to definition · View detail of BR-01 v.1 · Remove`**.

### 2.6 Jira side (1:54–2:32) — integration, phase 3

`Alt + Shift + R` in a Jira issue opens **Requirement Yogi links** with a relationship
picker (`Implements`), *"Relationships can be configured in the system administration"*,
`Criteria` chips (`In space TEAM`, `In baseline TEAM-1 "Baseline 1"`), a search box
*"Search by key or paste a link (Start with '?' for the advanced search syntax)"*,
`Add all`, and a result table `Key · Role · Title`. `Actions → Show baseline upgrades`
offers `Upgrade to v2` per link. Note the baseline identifier **`TEAM-1`** — space key
and baseline number.

### 2.7 Diff (0:10, 2:46–3:10 — full resolution)

```
 Diff
 Search  Coverage  Dependencies  Traceability  Baselines  [Diff]  Estimates  Excel        ⚙ ?

     First query: [ baseline = 1                                   ]
    Second query: [                                                ]
                  [Generate diff]  Display ▾  Compare ▾  Limit (600) ▾  ☐ Display descriptions      [Insert as a macro]

 baseline = 1                      State          Set 2
 BR-01 v1                          [MODIFIED]     BR-01
 BR-05 v1                          [REMOVED]      NON EXISTING            ← red text
```

- Column headers are the first query's text, `State`, and **`Set 2`** when the second
  query is empty (current requirements).
- `MODIFIED` is a dark indigo badge; `REMOVED` amber; `NON EXISTING` red text.
- **`Compare ▾`** lists *Description · External properties · Dependencies · Issues*.
  Slide: *"Choose the information you want to compare — tick 'Display the description'
  — and other fields such as properties, dependencies etc. — Click on 'Generate diff'."*
- With **Display descriptions** ticked, each row expands into side-by-side content:
  description, other columns, dependency badges, and external properties. **Removed text
  is red with strikethrough; added content has a green highlight.** Slide: *"Green: what
  has been added. Red: what has been removed."*
- Slide: *"The diff will display 600 requirements by default — You can configure the
  Global limit in the Administration."*

### 2.8 Page history (3:46–3:54)

`···` → `Page History`:

```
 Page History
 View, compare, or restore historical versions of this page. Older versions may be
 automatically deleted based on rules set by your administrator.
 [Compare selected versions]

 ☐  Version           Published           Changed By   Comment                                        Actions
 ●  CURRENT (v. 234)  Jul 25, 2023 13:08  admin
 ☐  v. 233            Jul 25, 2023 12:50  admin                                                       Restore  Delete
 ☐  v. 225            Jul 25, 2023 08:54  admin        Baseline "Baseline 3" for Requirement Yogi     Restore  Delete
```

**Freezing a baseline leaves a marked version in page history**, with the comment
`Baseline "<name>" for Requirement Yogi`.

The `···` menu (3:48): Attachments · Page History · Restrictions · People who can view ·
Analytics · Page information · Resolved comments · View in Hierarchy · View Storage
Format · Export to Word · Import Word Document · Requirement Yogi · Copy · Move · Delete.

### 2.9 Tips (3:22–3:40)

- *"You can use the baselines almost everywhere: In Jira, the search, Traceability, Diff
  and single pages."*
- *"We do not have branches: You cannot have two diverging versions of your docs."*
- *"We do not track every little change on requirements: See who made changes — go on
  the page, open the page history with the three dots on the top right."*

---

## 3. Excel import (VE)

Opening slides: *"Excel Import — Import new requirements from Excel."* · *"Requirements
won't be imported as pages."* · *"You will be able to reference them on pages."* ·
*"View them in the Search, or Traceability."*

### 3.1 Where it lives (0:20–0:42)

In the newer build, the External properties tab ends with two links:
**`Legacy Excel import — New Excel import`**. Slide: *"In the External Properties tab —
Click on Legacy Excel Import. You can also add it as new tab 'Excel Import' — Go in the
Administration, Manage Apps, and Modules: 'Excel tab in the space nav'."*

### 3.2 Upload (0:44–0:52)

```
 Requirement Yogi - Excel
 Excel attachments
 Name  Version  Creation Date  Last Modification Date  Labels  Attached To  Actions
 No Excel file in this space with the label 'ry-excel-import'.

 New File Upload
 File            [Choose file]  No file chosen
                 Upload an Excel file to parse it for requirements. Max 4000 requirements per import.
 Attach To Page* [                                    ]
                 Type the name of a page where the file will be attached
                 [Upload]
```

**Max 4000 requirements per import.** This settles the written docs' 2,000-vs-12,000
contradiction (research §6.7).

### 3.3 Mapping (0:56–1:18 — full resolution at 1:18)

Heading: the file name, e.g. `Specifications example Excel.xlsx - Requirement Yogi - Excel`.

```
 ⚠ Please complete the configuration. Requirements have not been imported yet.

 Uploaded File
       Name:  Specifications example Excel.xlsx
 Attached to: Specifications
       Links: ◉ Page attachments | ⌕ List
        File: [Choose file] No file chosen
              Upload an Excel file to parse it for requirements. If you don't change the
              configuration, then you can even upload it directly in the page's attachment form.
              [Reupload] [Cancel]

 Sheet 'Business and System Requirement'
   Import ? : [ No ▾ ]                  ← Yes / No per sheet
   Category : [                     ]
              Type an optional category to contextually group the requirements of this sheet

 [KEY ▾]          [DESCRIPTION ▾]    [PROPERTY ▾]     [PROPERTY ▾]     [- ▾]
                                     [Compliance  ]   [Performance ]
 Business_req_001 Users must be able… Regulatory      Response Time
 …
                                     [Import requirements]  [Delete]
```

- Every column has a role dropdown: **`KEY`**, **`DESCRIPTION`**, **`PROPERTY`** (with a
  name field beneath), or **`-`** (ignored).
- Each sheet is opted in with `Import ?` and may carry a `Category`.
- On import: a `Processing requirements …` toast, then an info banner
  **`46 requirements created.` / `File processed in 629ms`**.
- Imported requirements open the same popup, with `ORIGINAL DEFINITION` and the mapped
  properties; their Links column shows the Excel file as origin.

### 3.4 Using imported requirements (1:20–1:48)

- Search with `key ~ 'Business%'`. The echo line reads **"Requirements with key
  starting with 'Business' and in space 'TEAM' and with status 'ACTIVE'"**.
- Link to them from pages *"the same method as other requirements: In edit mode, add
  the macro pointing to an Excel key. If you click on the link, you will be sent to the
  imported page."*

### 3.5 Tips (1:50–2:42)

- *"If you want to edit the Excel requirements: You'll have to edit the file, and
  reupload it after edition."*
- *"For quicker edition, users tend to copy the content of the file in a Confluence page
  directly"* — demonstrated: paste the sheet into a page, select the key column, press
  `Alt + Shift + R`, and the bulk dialog (*"This will create one macro for each of the 27
  lines. Mode ◉ Use selected text as keys"*) turns the pasted keys into requirements.
- *"It is not possible to: Export requirements from Confluence pages, then reimport them"*
  and update the pages.
- *"However, it is possible to edit external properties in Excel"* — the Excel loop.

---

## 4. Administration (VA)

Opening: *"Administrator's Guide — Usually, there is nothing to configure, but we can
help you answer your users' questions."* Six chapters follow.

### 4.1 External properties tab (2:38 — full resolution)

```
 Requirements
 Search  Coverage  Dependencies  Traceability  Baselines  Diff  Reports  [External properties]   ⚙ ?

 External properties help you assign a value to requirements without editing the original
 page. They can be very useful for estimates or for the Excel loop with your customer.
    Upload Excel file [Choose file] No file chosen

 External properties                                                       [⚙] [Create new]
 0-6 out of 6
 Type       Key                                                            Actions
 STRING     Comments                                                       ✎
 FLOAT      Estimate                                                       ✎
 FLOAT      Estimate (Max)                                                 ✎
 BOOLEAN    Suspect                                                        ✎
 DROPDOWN   Status                                                         ✎
 INTEGER    Test                                                           ✎
 0-6 out of 6
 Legacy Excel import — New Excel import
```

Data types shown: **STRING, FLOAT, BOOLEAN, DROPDOWN, INTEGER**. The admin Properties
screen (3:00) names them *Text, Decimal number, Boolean, Dropdown, Integer*.

### 4.2 Traceability tab toolbar (2:54–2:56 — full resolution)

```
 Search: [                                        ] [⌕] [?]  [Save] [···]
         Optional. A normal search query, see search syntax.
         ☐ Get data from Jira
         Built in 151 ms.
 (●━)  Page size ▾ – 110 requirements – Show baselines – Cross-space – Export traceability matrix –  [Insert as a macro]

 Requirement [+ Add property]   │ Estimate      │ Estimate (Max)
 › BR-01                        │ [ 8.0      ]  │ [ 2        ]
   Business_requirement_001     │ [          ]  │ [          ]
```

- The **toggle** at the left of the second line turns edit mode on (green when on); in
  edit mode external-property cells become inputs.
- `+ Add property` opens *"Add external property column — Start typing to search… ▾ —
  Or create a new one — Type: Text ▾"*.
- Rows with children carry a `›` expander.
- Slides: *"If users request new external properties — make sure a similar one does not
  already exist — or create a new one."* · *"There is no limit to the number of external
  properties."* · *"Once created, it is not possible to rename external properties. It is
  possible to delete them entirely, with their values."*

### 4.3 Sidebar on the Requirements screen

`TRACEABILITY MATRIXES` with **`Recently viewed`**, **`Your queries`** and `View all`
(VA); set 1 showed **`Shared by others`** in the same position. All four groups exist.

### 4.4 Reindex (0:24–0:56)

- *"If there are discrepancies, a lack of synchronization between requirements… The
  reason may be related to an indexing problem"* — demonstrated with a requirement
  inside an **Expand** macro (*"Click here to expand…"*), whose page shows **"Requirement
  BR-01 — The requirement is DELETED. It used to be on the page Specifications. See below
  for the deleted requirement. Details of BR-01 …"**. A requirement page exists for
  deleted requirements and keeps their last known content and links.
- Space Tools → `Requirement Yogi` tab, sub-tabs **Options · Reindex · Fix Jira links ·
  Key suggestions · Trash**. Also reachable via Content Tools → `RY Reindex`.
- Reindex page: *"Reindex the space — If requirements are not up-to-date, this task will
  help you reindex the space. You will be able to interrupt the task at any moment
  without consequence. [Reindex]"*. While running: *"This task first searches for pages
  of the space (step 1: 5%), then resets the requirement definitions (step 2: 20%), then
  reindexes them (step 3: 75%)… For the task to progress, you must keep this page open.
  Reindex space (long running task) — Time Elapsed — Time Remaining (estimated) —
  Completion: 6% complete — Stop and cancel this task."*
- Slide: *"We do not recommend to reindex spaces regularly."*

### 4.5 Rename (1:02–1:46 — full resolution at 1:14)

- From the Search tab: select requirements, `Actions` → `Rename`.
- Search-box history: focusing the empty box lists previous queries
  (`key ~ 'BR-%'`, `key ~ 'TECH-%'`, …).
- A bare word is a valid query: `KEY` echoes **"Requirements containing 'KEY' and in
  space 'TEAM' and with status 'ACTIVE'"**.
- The rename screen is a **full page**, not a dialog:

```
 Rename requirements
 ☐ Ignore Jira errors
 Prefix              Middle          Suffix
 [ KEY-00        ]   [ 1 ] (grey)    [ A          ]     ← the only editable row
 KEY-00              2               A
 KEY-00              3               A
 …
 [Rename]  Cancel
```

- Result page: *"Rename Requirements Long Running Task Status — Rename requirements
  (long running task) — Time Elapsed: 1 seconds — Time Remaining: 0:00 (estimated) —
  Completion: 100% complete — ✓ Rename task finished successfully. Information:
  Requirement Yogi modified 14 macros on 2 pages to rename 7 requirements."*
- Slides: *"Only space administrators can rename requirements. Some users may want to
  have those permissions — Go in the RY Administration, under the Options tab — Add
  Confluence groups of users."* · *"You can also manage the permissions for baseline
  deletion here."*

### 4.6 Administration → Options (1:32–1:42 — full resolution at 1:36)

Administration tabs: **Getting started · Options · Queue · Integrations · Properties ·
Key suggestions · Upgrade tasks · Logging · Support · Usage metrics · Tutorials /
checklist**.

```
 Limits
   Global limit [ 12000 ]
                Default is 12 000. Maximum number of requirements that can be treated
                together at any time. Leave empty if unsure.
                ▸ Other limits   ▸ Traceability matrix limits   ▸ Popup options
                The limits for Excel exports are managed in the PSEA app: PSEA export limits.
                [Save]

 Permissions
   Requirements rename [            ]
       Comma-separated list of Confluence groups who are allowed to rename requirements.
       By default, only space administrators can use this feature. If a group is present,
       the user has to either be space admin, either be able to both edit the space and
       be in this group.
   Baseline deletion   [            ]
       Comma-separated list of Confluence groups who are allowed to delete baselines.
       By default, only space administrators can use this feature. If a group is present,
       the user has to either be space admin, either be able to both edit the space and
       be in this group. For example, if you use 'confluence-users', then only space
       admins and members of confluence-users who can also edit the space, will be allowed
       to perform this action.
   Export ☑ Allow export for anyone who can view requirements
       Default: Ticked. If you have performance issues with people exporting en masse,
       then disable this box, and the software will fall back on the normal export
       permissions of Confluence.
       Note: Anyone who can view requirements can always export them, with or without
       this option, using the REST API. This checkbox can only prevent the CPU-intensive
       operation of exporting to Excel.
   [Save]

 Indexing
   Indexing engine [VERSION 2]  Recommended for Data Center installations. …  [Change mode]
```

The set-1 admin frames also showed a **Public descriptions** setting —
`Default mode (confidential) ▾` with a confidential-vs-public comparison table. It
governs what Jira users see of requirement text.

`Getting started` (1:32): *"Requirement Yogi is properly installed. You can start with
the onboarding (see the last tab)."*, a Modules table (product version, extensions,
indexing engine, *Link to Jira ENABLED · Connection successful · More diagnostics*).

### 4.7 Key suggestions (1:46–2:14 — full resolution at 1:58)

Space Tools → `Requirement Yogi` → `Key suggestions`:

```
 Users generate new requirement keys in the editor. These options allow administrators
 to control which keys are generated.

 Settings
   ☑ Use global settings
       Default: Ticked. Inherit global settings for this space.
       If unticked, you can select the options below.
   ☑ Links across spaces                               (disabled while inheriting)
       Recommended: Ticked. If ticked, suggests requirements from other spaces when
       creating a link. Note: It is still possible to insert a cross-space link by
       pasting a direct link.
   ☐ Prevent reusing deleted keys
       Default: Unticked. If ticked, deleted requirement keys are never suggested again.
       Unless you wish to fully disable a key, you may prefer to keep every label available.
   ☐ Generate global keys
       Default: Unticked. If ticked, the generated keys will be unique across the entire
       Confluence instance.
   ☐ Lock keys
       Default: Unticked. If ticked, the user must select among the keys of the table below.
   [Save]

 Key Suggestions                          [200 items per page ▾]  First  Prev  1  Next  Last
 Prefix         Number        Suffix        Actions
 [         ]    [ 001     ]   [        ]    [Add]
 RFS-           007                         [Delete] Search
 SPEC-          00255                       [Delete] Search
 BR-            04                          [Delete] Search
```

- A suggestion is **prefix + zero-padded number + suffix**. The number's width is the
  padding.
- Slides: *"Restrict the keys that can be created."* · *"These are the prefixes that
  already exist and can be used."* · *"By default, suggestions are for the space, but you
  can override this setting."* · *"Unless suggestions are locked and already created,
  the suggestions will be created from the keys in the database."* · *"If you delete a
  suggestion, new keys will be based on the last sequence in the base."*

### 4.8 Properties (3:00)

```
 Changing the type of a property allows you to perform calculations in the Estimate tool.
 Properties are global: The type of a property is the same across all spaces, and if you
 press 'Remove', it will remove the values for this external property for the whole instance.

 Property name    Data type        INLINE   EXTERNAL   Actions
 Comments         Text             0        67
 Estimate         Decimal number   0        7
 Status           Dropdown         0        8
 Suspect          Boolean          0        4
 Test             Integer          0        0
```

Per property name, counts of **inline** and **external** values.

### 4.9 Queue (3:04–3:56)

```
 Delete all - Filter by status ▾ - Filter by queue ▾ - Filter by instance ▾   Refresh  Send

 Statistics
 Queue      Last execution               NEW  RETRY  DONE  FAILED
 Indexing   30 minutes 29 seconds ago    0    0      753   44
 Jira       12 minutes 25 seconds ago    0    0      402   0

 Messages                                                       0-50 out of 1212  Next >
 Message ID  Queue     Author  Contents                                  Status   Actions
 › 1223      INDEXING  admin   Indexing of Specifications                DONE     Delete
 › 979       INDEXING  admin   Indexing of Page test again               FAILED   Delete - Retry
```

Slides: *"When you link Confluence and Jira, messages are sent through a queue."* ·
*"It is good to monitor it from time to time."* · *"Failed messages can be caused by a
renamed key that will remove the Jira issue link."* · *"You can replay the message."* ·
*"The message will be deleted when you've more than 20,000."* · *"Users can see their
own queue, but will not be able to change the configuration"* — a **Personal queue**
item in the user menu opens a read-only view. · *"Make sure to check the queue in both
Confluence and Jira."* · *"The queue is versioned… Sys admins can choose a specific
version, but we don't recommend it."* · *"A user must be assigned to authenticate the
queue."*

### 4.10 Usage metrics (4:02–4:12)

*"We don't do telemetry, these metrics are just for you."* Expandable sections: **Top 20
spaces · Most recent spaces · Most recent users · Usage statistics (1 year)** — the last a
table `Date · BASELINES · REQUIREMENTS · TRACEABILITY`.

---

## 5. Recurring GUI details (all three videos)

### 5.1 Page byline product menu (VB 0:58 — full resolution)

Clicking the product icon in the byline opens a panel headed by the product logo:

```
 Links:
   • View in search (requirement definitions only)
   • View in search (definitions and links)
   • Dependency matrix
   • Re-index this page
   • Create baseline from this page / and its descendents
   • Compare to baseline…
```

### 5.2 Popup additions

- A link to a requirement **on the page currently open** carries a **`THISPAGE`** badge
  instead of `LINK` (VA 0:26).
- Cross-space dependencies render as `BRTEST-001 in space 'BUGTESTS' (parent_requirement)`.
- External properties render with `*`, e.g. `Status*: APPROVED`; values such as
  `Estimate*: 8.0` keep the type's formatting.

### 5.3 Page chrome in the newer build

Byline: `Pages / Team` · restriction icon · product icon · `1 Jira link` · `Analytics`;
page actions `Edit · View inline comments · Save for later · Watching · Share · ···`.

---

## 6. Frame index

| Video | t | Screen |
|---|---|---|
| VB | 0:10 | Diff — summary rows |
| VB | 0:22 | Baselines tab |
| VB | 0:24 | Create a baseline — step 1 |
| VB | 0:26 | Create a baseline — Baseline options |
| VB | 0:48 | Create a baseline — scope from search |
| VB | 0:58 | Page byline product menu |
| VB | 1:02 | Instant baseline panel |
| VB | 1:20 | Search with all versions — grey baselined rows |
| VB | 1:38 | Popup on `BR-01 v1` |
| VB | 1:48 | Editor link popover on a baselined link |
| VB | 2:42 | Baselines tab, two selected |
| VB | 3:00 | Diff with descriptions |
| VB | 3:16 | Administration → Options |
| VB | 3:50 | Page history with baseline markers |
| VE | 0:20 | External properties tab, Excel links |
| VE | 0:48 | Legacy Excel import — upload |
| VE | 1:18 | Excel mapping and import result |
| VE | 1:26 | Search for imported keys — echo line |
| VE | 2:20 | Bulk dialog over pasted Excel content |
| VA | 0:30 | Deleted-requirement page |
| VA | 0:48 | Reindex running |
| VA | 1:14 | Rename requirements |
| VA | 1:22 | Rename result |
| VA | 1:36 | Administration → Options |
| VA | 1:58 | Key suggestions |
| VA | 2:38 | External properties tab |
| VA | 2:56 | Traceability with external-property columns |
| VA | 3:00 | Administration → Properties |
| VA | 3:18 | Queue, failed filter |
| VA | 3:30 | Personal queue |
| VA | 4:12 | Usage metrics |

---

## 7. Gaps these videos do not close

- The baseline wizard's **Dependencies** step is never shown.
- No baseline **status other than `DONE`** appears — what a *freeze later* baseline
  displays is unknown.
- The **Reports** tab is never opened.
- The **Display ▾** menu on the Diff tab is never opened. The written docs say the diff
  filters rows as added, removed or modified; that is the reading we take.
- **Trash** under Space Tools is never opened.

---

## 8. What changes in the specs, in one line each

| Finding | Spec |
|---|---|
| Newer tab bar: Reports and External properties | `10` §9.1, `RD-038` |
| Baselines tab, wizard, instant baseline | `10` §14–15, `05` §2 |
| `KEY vN` notation, grey baselined rows, `Show current only` | `10` §9, `05` §4 |
| Diff screen, State column, Compare menu, highlight colours | `10` §16, `05` §5 |
| Freezing marks page history | `05` §3.2, `RD-041` |
| Byline product menu, verbatim | `10` §4.1 |
| `THISPAGE` badge, cross-space format | `10` §7 |
| Free-text query, `starting with` echo, query history | `02` §3, §8.1, `RD-039` |
| Key suggestion = prefix + number + suffix; settings and defaults | `03` §4.2, `06` §1, `10` §18 |
| Rename is a page; space admins by default; group override | `03` §5, `07` §2, `10` §17 |
| Baseline deletion and export permission settings | `07` §2, `10` §19 |
| External property types STRING, FLOAT, INTEGER, BOOLEAN, DROPDOWN; no rename | `01`, `04` §2, `RD-040` |
| Traceability toolbar and edit toggle | `10` §20 |
| Administration screens, queue, usage metrics | `10` §19, §21 |
| Deleted-requirement page | `10` §22 |
| Requirements inside collapsible blocks are indexed | `03` §2 |
| Excel import: max 4000, mapping roles, per-sheet opt-in | `PLAN` phase 7, `07` §4 |

---

## 9. Contradictions with set 1 and the written docs

| # | Earlier evidence | Set 2 | Resolution |
|---|---|---|---|
| 1 | Set 1 tab bar ends `Estimates · Excel` | Newer build ends `Reports · External properties` | **Newer build wins** — `RD-038` supersedes the tab bar in `RD-032` |
| 2 | Docs: Excel import limit 2,000 vs 12,000 | `Max 4000 requirements per import` | **Video wins.** `07` §4 |
| 3 | Docs: rename needs global admin or a configured group | *"Only space administrators can rename"*, with a group option that also needs edit-space | **Video wins.** `07` §2 |
| 4 | Our schema defaulted `preventReusingDeletedKeys` to true | Default **Unticked** | **Video wins** — default false |
| 5 | Our key pattern was a `FN-###` template | Suggestion is prefix + padded number + suffix | **Video wins** — `06` §1 |
| 6 | Our external property types included DATE and ENUM | STRING, FLOAT, INTEGER, BOOLEAN, DROPDOWN | **Video wins** — `RD-040` |
| 7 | Set 1 sidebar: Recently viewed, Shared by others | Newer: Recently viewed, Your queries | Both groups kept |
| 8 | Our spec: clicking a chip opens the key picker | Clicking a **link** chip shows `Transform to definition · View detail · Remove` | **Video wins** for link chips; definition chips still open the picker |
