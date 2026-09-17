# 02 — RQL, the Reqforge query language

RQL is a superset of Requirement Yogi's Data Center "Search Syntax", with Cloud's
traversal operator folded in. Every query in research §3.8 must parse and evaluate.

Where Requirement Yogi's documentation is silent — precedence, associativity, case
sensitivity, string escaping, NULL logic — this spec **decides**, and the decision is
recorded in `09-decision-log.md`. Those are marked **[decided]** below.

## 1. Pipeline

```
source → lexer → parser → AST → analyser → compiler → parameterised SQL
                                    │
                                    └─ produces typed errors with source offsets
```

The lexer, parser and analyser are pure and live in `src/domain/ryql/`. Only
`compiler.ts` knows about tables. **The compiler never string-interpolates a user value.**

## 2. Lexical structure

### 2.1 Tokens

| Token | Pattern |
|---|---|
| `IDENT` | `[A-Za-z_][A-Za-z0-9_]*` |
| `QUALIFIED_NAME` | after `@`: a run of characters ending at whitespace or an operator, where `\` escapes the next character |
| `STRING` | `'…'`, and also `'…'` / `"…"` curly forms **[decided]** |
| `NUMBER` | `-?\d+(\.\d+)?` |
| `VARIABLE` | `$IDENT` |
| `OPERATOR` | `= == != ~ < <= > >= -> →` |
| `PUNCT` | `( ) ,` |

**[decided] Keywords and field names are case-insensitive.** RY's own examples mix
`AND`/`and` and `TO`/`to`. Property *names* and *values* are case-sensitive; `spaceKey`
is case-sensitive; `key` compared with `~` is case-insensitive (research §3.2), and
`key_case_sensitive` is the case-sensitive variant.

### 2.2 Strings **[decided]**

- Delimiter: single quote. Curly quotes U+2018/U+2019 and double quotes are accepted as
  delimiters on input and normalised, because RY's rendered docs emit them.
- Escape inside a string: `\'` for a quote, `\\` for a backslash. RY documents none; we
  need one.
- Under `~`, `%` is the multi-character wildcard, `_` is **not** a wildcard (RY never
  documents one), and `\%` matches a literal percent sign.

### 2.3 Qualified names

Backslash escapes the following character, exactly as RY documents:
`@Main\ Category`, `parent@Test\ Result`, `ruleStatus@my\ rule`.

**[decided]** We additionally accept a quoted form — `@'Main Category'` — because
backslash-escaped names are unreadable in generated queries. Both forms produce the same
AST node. Generated links always emit the quoted form.

## 3. Grammar

```ebnf
query        = expr ;
expr         = or_expr ;
or_expr      = and_expr { OR and_expr } ;
and_expr     = not_expr { AND not_expr } ;
not_expr     = [ NOT ] primary ;
primary      = "(" expr ")" | predicate ;

predicate    = traversal
             | func_predicate
             | comparison
             | null_test
             | in_test
             | baseline_was ;

traversal    = field_ref "->" ( "(" expr ")" | predicate ) ;
comparison   = field_ref cmp_op value ;
null_test    = field_ref ( "IS NULL" | "IS NOT NULL" ) ;
in_test      = field_ref [ NOT ] "IN" "(" value { "," value } ")" ;
baseline_was = "baseline" "was" value ;
func_predicate = ident "(" [ value { "," value } ] ")" ;

field_ref    = ident [ "@" qualified_name ] ;
cmp_op       = "=" | "==" | "!=" | "~" | "LIKE" | "NOT LIKE" | "<" | "<=" | ">" | ">=" ;
value        = STRING | NUMBER | VARIABLE | func_value ;
func_value   = "user" "(" STRING ")" ;
```

### 3.1 Precedence and associativity **[decided]**

Tightest to loosest: `->` › comparison/`IS NULL`/`IN` › `NOT` › `AND` › `OR`.
All binary boolean operators are left-associative. This is the SQL convention; RY states
nothing, and every RY example is either fully parenthesised or a flat `AND` chain, so the
choice is compatible with every documented query.

The analyser emits a **warning** (not an error) for an un-parenthesised mix of `AND` and
`OR` at the same level, and the search UI renders the parse as the user typed it with
implied parentheses shown. Silent precedence surprises are the top support cost of
query languages.

## 4. Fields

| Field | Value | Maps to | Notes |
|---|---|---|---|
| `key` | string | `requirement.upperKey` | `~` is case-insensitive |
| `key_case_sensitive` | string | `requirement.key` | |
| `spaceKey` | string | `space.key` | case-sensitive |
| `status` | enum | `requirement.status` | `ACTIVE`\|`ARCHIVED`\|`MOVED`\|`DELETED` |
| `text` | string | `requirement.bodySearch` | **excludes properties** (research §3.2) |
| `title` | string | `requirement.title` | **[decided]** addition; RY has no such field |
| `baseline` | number \| name \| `$currentBaseline` | `requirement.baselineId` | |
| `baseline was` | number \| name | previous version's baseline | |
| `document` | id \| title | `DocumentLink` where `origin` | replaces RY's `page`; `page` is a **deprecated alias** |
| `documentHistory` | id | all versions of that document | replaces `pageHistory` |
| `links` | id | any `DocumentLink` | |
| `@<name>` | string \| number | `Property` kind `INLINE` | |
| `ext@<name>` | typed | `Property` kind `EXTERNAL` | typed comparison, per Cloud |
| `to@<rel>`, `parent@<rel>` | key | `Dependency` child→parent | bare `to`/`parent` = any relationship |
| `from@<rel>`, `child@<rel>` | key | `Dependency` parent→child | |
| `ruleStatus`, `ruleStatus@<type>` | `true`\|`false`\|`warning` | `RequirementValidation` | qualifier accepts **id or name** |
| `type` | string | `RequirementType.name` | **[decided]** addition |
| `label` | string | `RequirementLabel` | **[decided]** addition, see `RD-008` |

Deliberately **not** implemented: `jira`, `jira@rel`, `project`, `projectName`, `excel`,
`variant`. The first four are Atlassian-specific; `excel` belongs to an import path we
have not built; `variant` is `RD-009`, deferred.

## 5. Operator semantics

| Operator | Semantics |
|---|---|
| `=`, `==` | Strict equality. **For list-valued properties, set membership** (research §3.7) |
| `!=` | `NOT (a = b)` under two-valued logic — see §7 |
| `~`, `LIKE` | Case-insensitive match with `%` wildcard. Implemented as `ILIKE` |
| `NOT LIKE` | Negation of `~` |
| `<`, `<=`, `>`, `>=` | Numeric when both sides parse as numbers; otherwise **ASCII/collation-C string comparison**, which is what makes `@ReleaseDate > '2026-06-30'` work on ISO dates (research §3.3) |
| `IN`, `NOT IN` | Set membership over strict equality |
| `IS NULL` / `IS NOT NULL` | Valid on **every** field. RY restricts `IS NOT NULL` to `baseline` on DC; that restriction has no justification and we drop it (`RD-006`) |
| `->` | Existential traversal: matches if **at least one** requirement reached by the left field satisfies the right expression. Chainable. `→` is an accepted synonym |

### 5.1 Traversal depth **[decided]**

`->` chains are limited to **depth 4**. Deeper queries are rejected by the analyser with
a clear message. Unbounded traversal over a dependency graph with cycles is the easiest
way to hang the database, and RY documents no depth guarantee at all.

### 5.2 Cycles **[decided]**

Traversal is evaluated as repeated joins, not a recursive CTE, so cycles terminate
naturally at the depth limit. Transitive dependency *columns* in the traceability matrix
use a recursive CTE with a visited-set guard and the same depth limit.

## 6. Functions

| Function | Position | Semantics |
|---|---|---|
| `isModified(baseline)` | predicate | Requirement's current version differs from its snapshot in that baseline, **comparing title, body and inline properties** — the same field set as diff's default scope (research §5.5). Accepts number or name |
| `user(name)` | value | Matches a stored user reference by username **or** stable user id |
| `hasTest(...)`, `hasLastTest(...)` | predicate | **Not implemented in v1.** Reserved; the analyser reports "requires the testing module" rather than "unknown function" |

## 7. NULL semantics **[decided]**

RY documents nothing. We use **two-valued logic with absence-as-false**:

- A comparison against a field that has no row for this requirement is `false`.
- `NOT (predicate)` is the complement over the current result set — so
  `NOT (@Category = 'Functional')` includes requirements with no `Category` property.
- `IS NULL` means "no row exists, or the value is the empty string".

This matches how users actually read `NOT` in a requirements tool, and it matches RY's
own documented example `NOT (jira ~ '%')` meaning "requirements with no Jira issue".
It is *not* SQL three-valued logic; the compiler must be explicit about it and the tests
must pin it.

## 8. Default scope

Applied by the **analyser**, not the compiler, so it is visible in the AST and testable:

1. If no `spaceKey` predicate is present and the space is not `isolated`, scope to the
   current space. A "cross space" toggle removes this.
2. If no `baseline` predicate is present, scope to `baselineId IS NULL`.
3. If no `status` predicate is present, scope to `status = ACTIVE`.
4. If a `baseline` predicate **is** present, rule 3 is dropped (research §3.1).

**[decided]** The UI's baseline dropdown is a default, and an explicit `baseline` in the
query overrides it — matching Cloud's documented rule.

## 9. Errors

Every failure carries `{ code, message, offset, length, hint }` so the editor can
underline. Codes: `UNKNOWN_FIELD`, `UNKNOWN_FUNCTION`, `BAD_OPERATOR_FOR_FIELD`,
`TYPE_MISMATCH`, `UNTERMINATED_STRING`, `TRAVERSAL_TOO_DEEP`, `AMBIGUOUS_PRECEDENCE`
(warning), `NOT_IMPLEMENTED`.

`UNKNOWN_FIELD` suggests the nearest known field by edit distance, and specifically maps
`page` → `document`, `pageHistory` → `documentHistory`, `jira` → "not supported".

## 10. Test corpus — non-negotiable

`src/domain/ryql/__tests__/corpus/` contains one file per case:

1. **Every** example query from research §3.8, parsing to a pinned AST snapshot.
2. Every field × every valid operator, compiled to SQL and snapshotted.
3. Every field × every *invalid* operator, asserting the error code.
4. The precedence table: 20 queries mixing `AND`/`OR`/`NOT`/`->` with the expected tree.
5. NULL-semantics table from §7.
6. A fixture database with ~500 requirements, where every corpus query has an expected
   result-key set. This is the test that catches compiler regressions.

A change to the grammar that does not change the corpus is a change that is not tested.
