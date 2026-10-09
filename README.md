
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

**Slice 0 (walking skeleton) is built.** Sign in, a space list, an empty space page and the
application shell — top bar and space sidebar in both states — run end to end, with CI. Slice 1
(documents and the editor) is next; see [`PLAN.md`](PLAN.md).

## Getting started

Needs Node 22+, pnpm 10 and either Docker or your own PostgreSQL 16.

```bash
pnpm install
pnpm demo        # starts Postgres (Docker), migrates, seeds, runs the dev server
```

Then open <http://localhost:3000> and sign in. The seed creates two spaces and three users
with different permissions; the password for all three is `reqforge-dev`.

| User | `TEAM` | `PLAT` |
|---|---|---|
| `alice@reqforge.test` (instance admin) | view, edit, export, admin | view, edit, export, admin |
| `bob@reqforge.test` | view, edit, export | view (through the `platform-viewers` group) |
| `carol@reqforge.test` | view | — cannot see the space |

Without Docker, point `DATABASE_URL` in `.env` (created from `.env.example`) at your own
PostgreSQL and run `pnpm db:migrate && pnpm db:seed && pnpm dev`.

| Command | What it does |
|---|---|
| `pnpm verify` | prisma generate + typecheck + lint + unit tests + prisma validate. No database needed |
| `pnpm test:integration` | use-case and constraint tests against Postgres (a throwaway `reqforge_test` database) |
| `pnpm e2e` | Playwright against a production build (a throwaway `reqforge_e2e` database) |
| `pnpm copy:gen` | regenerate `src/copy/deck.generated.ts` from the spec's copy deck (`10` §13) |
| `pnpm db:reset` | drop, re-migrate and re-seed the development database |

The integration and e2e helpers refuse to run against any database whose name does not end in
`_test` or `_e2e`, because they truncate every table.

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
   what the Requirement Yogi documentation says, with gaps flagged.
5. [`docs/research/requirement-yogi-video.md`](docs/research/requirement-yogi-video.md)
   and [`requirement-yogi-videos-2.md`](docs/research/requirement-yogi-videos-2.md) — what
   the running product actually does, from four vendor screencasts (authoring, baselines,
   Excel import, administration). **They outrank the prose docs where they disagree.**
   The videos themselves sit in `docs/research/` and are git-ignored.
6. [`docs/specs/09-decision-log.md`](docs/specs/09-decision-log.md) — every deliberate
   divergence from Requirement Yogi, and why.

## The GUI

The interface reproduces the vendor screencast's GUI — layout, controls, defaults and
copy — so that people arriving from Requirement Yogi find everything where their hands
expect it. [`docs/specs/10-ui-reference.md`](docs/specs/10-ui-reference.md) draws every
screen and lists the few deliberate departures, starting with our own name and logo.

## The team

Nine specialist agents live in [`.claude/agents/`](.claude/agents/). Each owns a
narrow slice of the codebase and has its own definition of done. See
[`docs/team.md`](docs/team.md) for who to call when.

## Licensing note

Reqforge is a clean-room reimplementation built from public product documentation.
No Requirement Yogi source code, binaries or proprietary assets are used. Product
names are referenced only to describe behaviour being reimplemented.
