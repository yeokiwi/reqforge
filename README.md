
<img width="66" height="94" alt="image" src="https://github.com/user-attachments/assets/0ac1588d-ccea-47e8-82ad-bbdd1533f0a1" />

# Reqforge

A standalone requirements management and traceability web application, functionally
modelled on **Requirement Yogi for Confluence Data Center** — but with no Confluence,
no Jira and no Atlassian dependency.

Requirement Yogi works by annotating requirements inside Confluence pages. Reqforge
hosts the documents itself: spaces contain documents, documents contain requirement
markers, and everything Requirement Yogi builds on top of that (search syntax,
traceability, coverage, baselines, diff) is rebuilt against Reqforge's own store.

## Status

**Slices 0–10 of [`PLAN.md`](PLAN.md) are built.** You can sign in, write specification
documents in a rich-text editor, mark requirements inside them, link them to each other,
let the indexer project them into queryable rows with inline properties and dependencies,
search them in RQL, build, save, embed and export a traceability matrix over them, and
read the dependency grid and coverage numbers for any query, and embed live reports in
the documents themselves.

| Slice | What works |
|---|---|
| 0 | Next.js + Postgres + Prisma, email/password auth, spaces, seed data, CI |
| 1 | Document tree, TipTap editor, an immutable version on every save, history view |
| 2 | The `requirement` marker, the three scope layouts, the pure indexer, requirement pages |
| 3 | Key validation, key patterns, next-key suggestion, sequences, locking |
| 4 | `propertyConfig`, column-header properties, title columns, list-valued cells |
| 5 | RQL lexer, parser and analyser, with the query corpus |
| 6 | The SQL compiler, the search screen, saved searches, the performance budget |
| 7 | `requirementLink`, dependencies named by column header, broken links, `to`/`from` |
| 8 | Traceability matrix, saved matrices, embedding, the job queue and xlsx export |
| 9 | Dependency grid with the 40,000-cell cap, coverage with targets, two-sheet export |
| 10 | Embedded reports: the columns mini-syntax, count-only, "last requirement", guards |
| 11 | External properties: instance-global definitions, typed `ext@`, in-place and bulk editing |
| 12 | Requirement types: rules, validation on save and on type change, `ruleStatus`, quick fixes |
| 13 | Baselines: drafts, the batched freeze job, pinning, materialised images, refreeze |
| 14 | Diff over two queries, `isModified()`, `baseline was`, per-requirement history |
| 15 | Single and batch rename with the live prefix/middle/suffix transform, propagation into documents and saved queries, the transactional job, the `renamedFrom` chain |
| 16 | Document restrictions inherited down the tree, rule X4 on baselines, the X3 architecture rule, ordered classification labels on every export, permission and group administration, the audit log |
| 17 | `/api/v1` over every use case, scoped API tokens, OpenAPI 3.1 generated from the routes, keyset cursors, jobs endpoints, HMAC-signed webhooks with an outbox, retries and a dead-letter view |

Not built yet: performance and limits (slice 18).

Known gaps inside what is built, each waiting on the slice that owns it:
computed columns (`RD-004`) come after coverage; `public-link` matrix visibility is
deferred (`RD-030`: a public link has no reader for rule X3 to filter by); a link's `displayProperty` is stored but
not yet rendered live.

## The API

Everything the screens do is also under `/api/v1` (spec `08`). Create a token on
**API tokens** (`/settings/tokens`), then:

```bash
TOKEN=rf_…
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/spaces/SJ/requirements?q=key%20~%20'FN-%25'&limit=2&expand=validation"
# → { "items": [...], "hasMore": true, "nextCursor": "…" }  — pass ?cursor= for the next page

curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d @document.json http://localhost:3000/api/v1/spaces/SJ/documents/<id>
# → { "version": 4, "valid": false, "diagnostics": [...] }  — a CI job's verdict, at once

curl http://localhost:3000/api/v1/openapi.json   # the full surface, generated from the routes
```

Webhooks are managed per space under **Admin → Webhooks**. Payloads carry identifiers
only (`RD-066`). Verify `X-Reqforge-Signature` as
`v1=hex(HMAC-SHA256(secret, X-Reqforge-Timestamp + "." + body))`.

## Background jobs

Exports run as jobs (spec `00`, decision 4). With `JOBS_INLINE=1` the web process runs
them itself, which is the default for development and tests. In production run the worker
alongside the app:

```bash
pnpm worker          # claims queued jobs; safe to run next to the web process
```

## Running it

```bash
docker compose up -d db          # or any PostgreSQL 16
cp .env.example .env
pnpm setup                       # install, migrate, seed
pnpm dev                         # http://localhost:3000
```

Seeded accounts: `admin@reqforge.test` / `reqforge-admin`,
`author@reqforge.test` / `reqforge-author`, `reader@reqforge.test` / `reqforge-reader`.

`pnpm verify` runs typecheck, lint, unit and integration tests, and `prisma validate`.
`pnpm e2e` runs the Playwright suite.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) + TypeScript, strict |
| Database | PostgreSQL 16 |
| ORM / access | Prisma for schema + CRUD; hand-written SQL for the query engine |
| Editor | TipTap / ProseMirror, with custom `requirement` and `requirementLink` nodes |
| Testing | Vitest (unit), Playwright (e2e), golden-file tests for the query grammar |

## Where to start reading

1. [`PLAN.md`](PLAN.md) — the vertical slices, in build order.
2. [`CLAUDE.md`](CLAUDE.md) — the conventions every agent (and human) follows.
3. [`docs/specs/`](docs/specs/) — implementation-ready specifications.
4. [`docs/research/requirement-yogi-dc.md`](docs/research/requirement-yogi-dc.md) —
   what the Requirement Yogi documentation actually says, with gaps flagged.
5. [`docs/specs/09-decision-log.md`](docs/specs/09-decision-log.md) — every deliberate
   divergence from Requirement Yogi, and why.

## The team

Nine specialist agents live in [`.claude/agents/`](.claude/agents/). Each owns a
narrow slice of the codebase and has its own definition of done. See
[`docs/team.md`](docs/team.md) for who to call when.

## Licensing note

Reqforge is a clean-room reimplementation built from public product documentation.
No Requirement Yogi source code, binaries or proprietary assets are used. Product
names are referenced only to describe behaviour being reimplemented.
