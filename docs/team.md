# The team

Nine agents, defined in [`.claude/agents/`](../.claude/agents/). Each owns directories.
Ownership is not territorial pride — it is how we keep two agents from writing
contradictory implementations of the same rule in the same week.

| Agent | Owns | Reads | Called for |
|---|---|---|---|
| `spec-keeper` | `docs/**` | everything | Ambiguity, spec drift, new decisions, slice kick-off and sign-off |
| `domain-modeler` | `prisma/**`, `src/server/repositories/**` | `01`, `06` | Schema, migrations, invariants, external properties, requirement types |
| `ryql-engineer` | `src/domain/ryql/**` | `02` | Grammar, parser, analyser, SQL compiler, query errors |
| `authoring-engineer` | `src/editor/**`, `src/domain/indexer/**`, `src/domain/keys/**` | `03` | Editor nodes, scope rules, indexing, keys, renaming |
| `traceability-engineer` | `src/domain/traceability/**` + its routes | `04` | Dependencies, matrices, coverage, reports |
| `baseline-engineer` | `src/domain/baselines/**` + its routes | `05` | Freeze, refreeze, diff, `isModified`, history |
| `platform-engineer` | `src/app/**`, `src/server/{usecases,authz,jobs}/**` | `00`, `07`, `08` | Routes, screens, auth, permissions, jobs, API, infra |
| `test-engineer` | `**/__tests__/**`, `e2e/**`, fixtures | everything | Corpus, fixtures, property tests, performance gates |
| `code-reviewer` | nothing | everything | Every pull request, before merge |

## Hand-off protocol

A task that needs a change outside your lane does not get done by reaching over. Write
the request in this shape and hand off:

```
TO: <agent>
NEED: <the behaviour you need, not the implementation>
BECAUSE: <the spec section or acceptance check that requires it>
SHAPE: <the signature or column you expect, if you have an opinion>
BLOCKING: <yes/no — can you continue without it?>
```

If it is not blocking, stub against the expected shape, mark it `// HANDOFF: <agent>`,
and keep going.

## Escalation to `spec-keeper`

Call `spec-keeper` — do not decide alone — when:

- the spec and the research notes disagree;
- the research notes say a behaviour is a **Gap**;
- the change touches one of the four load-bearing decisions in `CLAUDE.md`;
- two agents need the same file.

`spec-keeper` answers with either a spec citation or a new `RD-nnn` entry. It never
answers "do whatever seems reasonable".

## Which agents are live per slice

Most slices need two or three. `PLAN.md` names the lead and the hand-offs for each.
Running all nine on one slice is a smell — it means the slice is not vertical, it is a
phase in disguise.

## Review gate

`code-reviewer` runs on every change and checks, in order:

1. Does it do what the slice's acceptance list says?
2. Does it match the cited spec sections, or update them?
3. Does it violate a numbered invariant (`01`), contract (`03`), or rule (`07`)?
4. Are the tests the spec demands actually present, and do they fail without the change?
5. Is anything invented about Requirement Yogi's behaviour that the research notes do not
   support?

Point 5 is the one humans skip and the one that costs most later.
