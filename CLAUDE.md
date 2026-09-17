# Reqforge — working agreement

This file is read by every agent on every task. Keep it short enough that it stays read.

## What we are building

A standalone requirements traceability application with the functionality of
Requirement Yogi for Confluence Data Center, minus Confluence. Read
`docs/specs/00-overview.md` before your first task on this repo.

## Non-negotiables

1. **The spec is the contract.** If the code and `docs/specs/` disagree, one of them is
   a bug. Fix the one that is wrong, in the same PR, and say which.
2. **No invented Requirement Yogi behaviour.** Requirement Yogi's docs are incomplete
   in known places — they are catalogued in `docs/research/requirement-yogi-dc.md`
   under "Gaps". When you hit a gap, you are *designing*, not *reproducing*. Record the
   choice in `docs/specs/09-decision-log.md` as a new `RD-nnn` entry. Never silently
   guess and never write "Requirement Yogi does X" unless the research notes say so.
3. **Vertical slices only.** A slice ships schema + query + API + UI + tests together
   and is demoable. No horizontal "build all the models first" work.
4. **Tests before the merge, not after the milestone.** Every slice's definition of
   done includes its tests. The query engine is golden-file tested: every example
   query in `docs/specs/02-query-language.md` is a test case.
5. **Stay inside your lane.** Agents own directories (see `docs/team.md`). If your task
   needs a change outside your lane, state the change you need and hand off — do not
   reach in and edit another agent's files.

## Code conventions

- TypeScript `strict: true`. No `any` — use `unknown` and narrow.
- No default exports except Next.js pages/layouts/route handlers.
- Domain logic lives in `src/domain/**` and must not import from `src/app/**`.
  Dependency direction is one-way: `app → server → domain → db`.
- Database access goes through `src/server/repositories/**`. No Prisma client imports
  in route handlers or components.
- The query engine (`src/domain/ryql/**`) is **pure**: parser and analyser have zero
  database imports. Only the compiler emits SQL, and it emits parameterised SQL only.
- Errors thrown across a boundary are typed (`AppError` subclasses), never bare strings.
- Every exported function that implements a spec rule carries a comment referencing the
  spec section, e.g. `// spec: 02-query-language.md §4.3 (soft equality)`.

## Naming that matters

We keep Requirement Yogi's vocabulary because users coming from it will expect it:
*space, document, requirement, key, property, external property, dependency,
relationship, baseline, traceability matrix, coverage, diff, requirement type*.

We deliberately renamed two things — see `RD-002` and `RD-003` in the decision log.

## Definition of done (applies to every task)

- [ ] Code compiles with no TypeScript errors and no new ESLint warnings.
- [ ] Unit tests cover the rules the spec states, including the stated edge cases.
- [ ] Spec updated if behaviour changed; decision log updated if a gap was filled.
- [ ] `pnpm verify` passes (typecheck + lint + test + prisma validate).
- [ ] The change is described in one paragraph a reviewer can check against the spec.

## What "vibe coding" means here, and what it does not

Move fast on implementation; do not move fast on the four things that are expensive to
undo later:

- the **identity model** of a requirement (`space, key, baseline`),
- the **query grammar**,
- the **indexer contract** (document → requirements),
- the **baseline freeze semantics**.

Changes to any of those four need a decision-log entry and a second opinion from
`spec-keeper` before implementation.
