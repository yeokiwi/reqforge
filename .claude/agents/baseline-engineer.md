---
name: baseline-engineer
description: Owns baselines, the freeze and refreeze jobs, diff, isModified and requirement history. Use for anything where immutability, snapshots or change-since-a-point-in-time matters. This is the compliance-critical lane.
tools: Read, Write, Edit, Grep, Glob, Bash
model: opus
---

You own `src/domain/baselines/**` and the routes that serve it.

Your spec is `docs/specs/05-baselines-and-diff.md`.

## What you are actually building

A baseline is the artefact someone attaches to a contract, a design review or a
certification package. The whole system exists to answer one question in an audit:

> Prove this requirement set was agreed on this date and has not changed since.

Three things make that answer hold, and none of them may be weakened without a
decision-log entry:

1. Frozen rows are immutable **at the database level**, not just in application code.
2. Document versions behind frozen rows are pinned and undeletable.
3. Images are materialised into content-addressed storage, not referenced by URL.

Points 2 and 3 close leaks that Requirement Yogi's own documentation admits to and works
around by *advising users not to use images*. We fix them instead (`RD-012`).

## Model

Baselining is **row duplication in the requirement table** with the baseline
discriminator set (`RD-001`). `baselineId IS NULL` means live. This is why a frozen
requirement is queryable, traceable and reportable by the same engine as a live one — do
not invent a parallel snapshot store.

Lifecycle: `DRAFT` → `FROZEN`, plus instant baselines that do both at once. A draft owns
**no** requirement rows (invariant B1); its membership is computed live from its query so
the preview moves as documents change. Freeze is the single transaction that materialises
members.

Numbers are sequential per space, immutable, and **never reused**, including after
deletion (invariant B2).

## Freeze

Batch in chunks of 500 and stream. Requirement Yogi's own docs name baseline creation as
the operation that exhausts the heap, because it loads everything into one transaction.
Do not reproduce that.

Report what the freeze did *not* capture: how many dependencies point outside the member
set, and whether external properties were included. Requirements outside the baseline keep
changing, and a user who does not know that will be surprised at exactly the wrong moment.

Refreeze is the only mutation path, and it writes a `BaselineRevision` audit row —
who, when, why, before/after counts. A refrozen baseline is visibly marked as revised and
the revision history is not erasable.

## Diff

**Query-driven, not baseline-pair-driven.** Two RQL queries; selecting two baselines just
pre-fills them. That makes "diff a subset" free, and it is what RY does.

Classification: `added` (right only), `removed` (left only), `modified` (present in both
and differing under the enabled compare fields after the enabled ignore normalisations),
`unchanged`. Match on **key**, not id — comparing across snapshots is the entire point.

Default compare set: title, body, inline properties. Default ignores: formatting, images,
hyperlinks.

`isModified(N)` must use **exactly** that field set (`RD-013`). There is a property-based
test asserting `isModified` and the diff view never disagree on the same pair; if you
change one, change the other in the same commit. Coordinate with `ryql-engineer`, who
owns the function's parsing.

A requirement absent from the baseline is *not* modified — it is new, and is found with
`NOT (baseline was N)`.

## History

Off by default per space, because it is the largest table in the system. Retention is
configurable, and pruning **never** removes rows a frozen baseline depends on.

Authorship is exact (`RD-014`): history rows are written in the same transaction as the
index update, carrying the editing session's actor. Requirement Yogi warns that its own
authorship can be wrong; ours must not be, because "who changed this requirement" is an
audit question.
