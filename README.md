
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

**Slices 0–6 of [`PLAN.md`](PLAN.md) are built.** You can sign in, write specification
documents in a rich-text editor, mark requirements inside them, let the indexer project
them into queryable rows with inline properties, and search them in RQL.

| Slice | What works |
|---|---|
| 0 | Next.js + Postgres + Prisma, email/password auth, spaces, seed data, CI |
| 1 | Document tree, TipTap editor, an immutable version on every save, history view |
| 2 | The `requirement` marker, the three scope layouts, the pure indexer, requirement pages |
| 3 | Key validation, key patterns, next-key suggestion, sequences, locking |
| 4 | `propertyConfig`, column-header properties, title columns, list-valued cells |
| 5 | RQL lexer, parser and analyser, with the query corpus |
| 6 | The SQL compiler, the search screen, saved searches, the performance budget |

Not built yet: dependencies and traceability (slices 7–10), external properties and
requirement types (11–12), baselines, diff and renaming (13–15), and the hardening slices
(16–18). `baseline was` and `isModified()` parse today and report `NOT_IMPLEMENTED` from
the compiler until the diff engine lands in slice 14.

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
