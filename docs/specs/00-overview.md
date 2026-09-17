# 00 — Overview and architecture

## The one-paragraph version

Reqforge is a standalone web application where teams write specification documents,
mark requirements inside them, and then query, trace, baseline and diff those
requirements. It reproduces the functionality of Requirement Yogi for Confluence Data
Center without Confluence: Reqforge owns the document store, so the indexer reads
Reqforge's own document model rather than Confluence page XHTML.

## The five concentric layers

```
┌─ app ────────── Next.js App Router: pages, route handlers, React components
│  ┌─ server ──── use-cases, authz, repositories, background jobs
│  │  ┌─ domain ─ pure logic: RYQL, indexer rules, diff, coverage, key suggestion
│  │  │  ┌─ db ── Prisma schema, migrations, raw SQL for the query compiler
```

Imports point inward only. `domain` has no database and no React imports; it is the
part we can test exhaustively and cheaply, so as much logic as possible lives there.

## Directory map (target)

```
src/
  app/                       # routes; thin — parse, authorise, call a use case, render
    (auth)/
    s/[spaceKey]/            # space-scoped screens
      documents/[docId]/
      search/
      traceability/
      dependencies/
      coverage/
      baselines/
      diff/
      admin/
    api/                     # REST surface (see 08-api-surface.md)
  server/
    usecases/                # one file per use case, transaction boundary lives here
    repositories/            # the only place Prisma is imported
    authz/                   # permission checks (see 07-permissions-and-limits.md)
    jobs/                    # async queue: reindex, rename, freeze, export
  domain/
    ryql/                    # lexer, parser, AST, analyser, SQL compiler
    indexer/                 # document AST -> requirement records
    keys/                    # key validation, patterns, suggestion sequences
    traceability/            # matrix shaping, coverage counting
    baselines/               # freeze plan, diff engine
    types/                   # requirement-type validation
  editor/                    # TipTap schema, nodes, marks, UI plugins
prisma/
docs/
```

## The four load-bearing decisions

Everything else can be refactored cheaply. These cannot, so they are fixed up front and
changing them requires a decision-log entry (`CLAUDE.md`, "Definition of done").

### 1. Requirement identity is `(spaceId, key, baselineId)`

`baselineId IS NULL` means the live/current version. Freezing a baseline **duplicates
rows in the same table** with the baseline id set. This mirrors Requirement Yogi's
`SPACEKEY + KEY + BASELINE` model exactly (research §5.7) and it is why baselined
requirements can be queried with the same engine as live ones.

### 2. The document is the source of truth; the requirement table is a projection

A requirement's text, inline properties and dependencies are *derived* from the document
by the indexer. Editing a requirement means editing the document. External properties,
baselines and requirement-type results are the only requirement data that does **not**
come from the document — which is exactly why external properties exist.

Corollary: the indexer must be deterministic and re-runnable. Reindexing a document must
produce byte-identical requirement rows given identical document content.

### 3. RYQL compiles to parameterised SQL, once

The query language is used by the search screen, the traceability matrix, the dependency
matrix, coverage, diff, reports and the REST API. There is exactly one parser and one
compiler. No feature is allowed to build SQL from user input by any other route.

### 4. Everything expensive is a job

Freeze, rename, reindex-space, matrix export and import all run on a durable job queue
with progress, cancellation and rollback. Requirement Yogi learned this the hard way —
its own docs name baseline creation as the operation that exhausts the heap
(research §6.7).

## What we deliberately do differently

Requirement Yogi's own documentation lists four gaps in the product (research §6.8):
no status field, no calculated fields, no branching, no variants. Three of them are
cheap for us because we own the schema. They are scheduled as `RD-` decisions rather
than assumed — see `09-decision-log.md`.

The other systematic difference: Requirement Yogi inherits Confluence's permission model
and explicitly ignores page-level restrictions. Reqforge has its own model and does not
carry that hole forward (`07-permissions-and-limits.md`).

## Reading order for a new agent

1. This file.
2. `01-domain-model.md` — you will touch these entities whatever you build.
3. The spec for your lane (`docs/team.md` says which).
4. `09-decision-log.md` — skim the titles; read any `RD-` your lane touches.
