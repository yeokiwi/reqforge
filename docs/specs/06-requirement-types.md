# 06 — Requirement types and validation

Requirement Yogi merged "key suggestions" into "requirement types" in 4.0, and states the
relationship plainly: *"The only difference between a simple 'key suggestion' and a
requirement type is having a name."* (research §2.3). We model exactly one entity.

## 1. The entity

```ts
type RequirementType = {
  id: string;
  spaceId: string;
  name: string | null;        // null => a bare key suggestion
  keyPattern: string;         // e.g. "FN-###"
  colour: string;
  locked: boolean;            // restrict the space to configured patterns
  nextSequence: number;
  preventReusingDeletedKeys: boolean;
  rules: RequirementTypeRule[];
  templateColumns: TemplateColumn[];
};

type RequirementTypeRule =
  | { kind: 'REQUIRED_PROPERTY'; name: string }
  | { kind: 'OPTIONAL_PROPERTY'; name: string }
  | { kind: 'REQUIRED_DEPENDENCY'; relationship: string; direction: 'to' | 'from' }
  | { kind: 'PROPERTY_MATCHES'; name: string; pattern: string }    // RD-015
  | { kind: 'PROPERTY_IN'; name: string; values: string[] };       // RD-015
```

The first three are what RY documents. `PROPERTY_MATCHES` and `PROPERTY_IN` are our
addition: RY has no rule expression language at all (research §2.4 gap) and its own
limitations page says a rules engine is "planned, medium term" and not to count on it
(research §6.8). Two narrow, declarative rule kinds cover the overwhelming majority of
real validation needs — a status column drawn from a fixed list, an identifier matching a
pattern — without inviting a scripting language into the product.

**Not in v1**: cross-requirement rules, rules referencing other requirements' properties,
or anything requiring evaluation order. If a rule cannot be decided from one requirement
plus its immediate dependency relationships, it does not belong here.

## 2. Validation

### 2.1 Result

```ts
type ValidationStatus = 'TRUE' | 'FALSE' | 'WARNING';
```

Mapping, matching RY's colours (research §2.4):

| Condition | Status | Editor rendering |
|---|---|---|
| All required properties and dependencies present, all value rules pass | `TRUE` | no marker |
| A required property or dependency is missing, or a value rule fails | `FALSE` | red pill, red byline warning |
| An optional property is missing, or the table has no real header row | `WARNING` | yellow pill, edit mode only |

Results are cached in `RequirementValidation` and read by RQL's `ruleStatus` /
`ruleStatus@<type>` field.

### 2.2 When validation runs

RY documents exactly two triggers and states that rerunning everything across a space is
impossible (research §2.4). That limitation is an artefact of Confluence's indexing model,
not a design goal, so we have three:

1. **On index** — every document save revalidates the requirements in that document.
   Cheap, because the requirement and its properties are already in hand.
2. **On type change** — editing a type enqueues a job revalidating every requirement of
   that type in the space, with progress. This is the one RY cannot do (`RD-016`).
3. **On demand** — a "run validation" action per type or per space.

### 2.3 Limits

RY's per-run limits (200 SQL requests, 1000 messages, 5 seconds, max 20 types per page)
exist because validation ran inside a page render. Ours runs in the indexer and in jobs,
so the relevant limits are different and stated here:

- Max **40 rules** per type; max **20 types** per space applying to one document.
- Validation of one requirement must issue **zero** additional queries — everything it
  needs is in the `IndexResult` or loaded in the job's batch. This is a hard rule, tested
  with a query counter.
- A `REQUIRED_DEPENDENCY` rule with `direction: 'from'` reads an edge declared in *another*
  document, so it is neither. One batched query per document (on save) or per page (in the
  job) loads the inbound edges before validation runs — see `RD-040`, which states the
  per-requirement reading the query counter measures.

## 3. Templates

Inserting a key of a type into an **empty** table scaffolds the type's required and
optional columns, in `ordinal` order, with the required ones first. "Empty" means every
cell is blank and the table holds no marker, link, report or embedded matrix. It does
nothing once the table has content — RY's documented behaviour (research §2.4), kept
because rewriting a table the user has already filled is hostile.

`templateColumns` also seeds a "new document from type" flow: a document skeleton with
one correctly-shaped table.

## 4. Quick fixes

Every `FALSE` and `WARNING` diagnostic that can be repaired mechanically carries a fix:

| Diagnostic | Fix |
|---|---|
| `MISSING_REQUIRED_PROPERTY` | add the column to the table (and to this row only, in vertical layout) |
| `MISSING_OPTIONAL_PROPERTY` | same |
| `MISSING_REQUIRED_DEPENDENCY` (`to`) | put the cursor in that relationship's column and open the link picker |
| `MISSING_REQUIRED_DEPENDENCY` (`from`) | **none** — the edge must be declared in the document at the other end |
| `TABLE_HAS_NO_HEADER` | promote the first row to a header row |
| `KEY_NOT_ALLOWED` | offer the nearest matching type's next key |
| `PROPERTY_NOT_IN_VALUES` | replace with a valid value (dropdown) |
| `PROPERTY_DOES_NOT_MATCH` | **none** — no value can be invented that satisfies an arbitrary pattern |

Fixes are ProseMirror transactions and must be individually undoable. *What* the repair is
is decided in a pure function and travels with the diagnostic as data (`RD-042`); the
editor holds only the mechanics. A validation run with no document in hand — the
revalidation job — decides the status and offers no fix.

## 5. Permissions

Straight from RY (research §2.4):

| Capability | Permission |
|---|---|
| Read types and their rules | view space |
| Run one type's validation, reset a key sequence | edit space |
| Create, update, delete types; lock keys | space admin |

## 6. The status field question

RY has **no status field on requirements** and its docs admit customers fake it with
third-party macros, with no validation and unvalidated typos (research §6.8).

We do not add a first-class status column either — a requirement's status is a property,
because different organisations need different lifecycles. What we add instead is
`PROPERTY_IN`, so a space can declare `Status ∈ {Draft, Reviewed, Approved, Obsolete}`
and get validation, a dropdown quick fix and `ruleStatus` filtering for free. That is
`RD-015`, and it is the single highest-value divergence in this specification.
