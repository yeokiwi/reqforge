
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

**Pre-slice-0.** This repository currently contains the specification, the plan, and
the agent team that will build it. No application code has been written yet.

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
