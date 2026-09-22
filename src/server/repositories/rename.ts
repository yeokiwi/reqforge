import { Prisma } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '@/domain/errors';
import { rewriteKeys } from '@/domain/doc/rewrite-keys';
import type { PMNode } from '@/domain/doc';
import { indexDocumentVersion } from '@/domain/indexer';
import { buildMapping, RENAME_MAX_DOCUMENTS, RENAME_MAX_REQUIREMENTS } from '@/domain/keys/rename';
import { upperKey } from '@/domain/keys/validate';
import { rewriteKeyLiterals } from '@/domain/ryql/rewrite';
import { recordAuditEventIn } from './audit';
import { prisma } from './client';
import { writeDocumentVersion } from './documents';
import { recordHistory, type HistoryEntry } from './history';
import { applyIndexResult } from './requirements';
import { advanceSequencesForKeys, listTypesWithRules, rulesOf } from './requirement-types';

/**
 * Renaming requirement keys.
 * spec: 03-authoring-and-indexing.md §5. RD-050 (rewrite the document and reindex),
 * RD-051 (the alias chain), RD-052 (what is frozen provenance and is never rewritten),
 * RD-054 (the limits).
 *
 * Everything here happens in **one transaction**: Requirement Yogi's rename reports "No
 * modification was saved" on any error, and that promise is only worth making if the
 * database keeps it. Baselined rows are never in a filter — every write is scoped to
 * `baselineId: null` — and the invariant-R2 trigger is the backstop if one ever slips
 * through (RD-007).
 */

export type RenamePair = { from: string; to: string };

export type RenameSummary = {
  renamed: number;
  documentsRewritten: number;
  queriesRewritten: number;
  /** Saved queries that no longer parse, named so a human can fix them. */
  queriesSkipped: string[];
  unresolvedRewritten: number;
};

export type RenameHooks = {
  /** Polled between documents. Returning true rolls the whole rename back. */
  cancelled?: () => Promise<boolean>;
  progress?: (percent: number, message: string) => Promise<void>;
};

export type RenameInput = {
  spaceId: string;
  spaceKey: string;
  isolated?: boolean;
  actorId: string;
  jobId?: string;
  pairs: readonly RenamePair[];
  historyEnabled?: boolean;
};

/** Thrown to unwind the transaction on cancellation; never surfaces to the caller. */
class RenameCancelled extends Error {
  constructor() {
    super('The rename was cancelled.');
  }
}

export class RenameWasCancelled extends Error {}

/**
 * The sentinel key a row wears between the two phases of the update. `~` is outside the
 * key alphabet (spec 03 §4.1), so a sentinel can never collide with a real key, and the
 * row id makes it unique among the sentinels. A NUL byte would be neater still, but
 * Postgres text cannot hold one.
 */
function sentinelFor(id: string): string {
  return `~rename~${id}`;
}

export async function renameRequirements(
  input: RenameInput,
  hooks: RenameHooks = {},
): Promise<RenameSummary> {
  if (input.pairs.length === 0) return emptySummary();
  if (input.pairs.length > RENAME_MAX_REQUIREMENTS) {
    throw new ValidationError(
      `A rename covers at most ${RENAME_MAX_REQUIREMENTS.toLocaleString()} requirements at a time; this one covers ${input.pairs.length.toLocaleString()}.`,
    );
  }

  try {
    return await prisma.$transaction(async (tx) => renameInTransaction(tx, input, hooks), {
      // A batch rename rewrites and reindexes every document that mentions a key. The
      // default 5 s is a limit on how much of that one transaction may do, not a
      // performance target.
      timeout: 120_000,
      maxWait: 20_000,
    });
  } catch (error) {
    if (error instanceof RenameCancelled) throw new RenameWasCancelled(error.message);
    throw error;
  }
}

function emptySummary(): RenameSummary {
  return { renamed: 0, documentsRewritten: 0, queriesRewritten: 0, queriesSkipped: [], unresolvedRewritten: 0 };
}

async function renameInTransaction(
  tx: Prisma.TransactionClient,
  input: RenameInput,
  hooks: RenameHooks,
): Promise<RenameSummary> {
  const summary = emptySummary();
  const check = async (): Promise<void> => {
    if (await hooks.cancelled?.()) throw new RenameCancelled();
  };
  await check();

  // ---------------------------------------------------------------- 1. resolve the rows
  const sources = input.pairs.map((pair) => upperKey(pair.from));
  const rows = await tx.requirement.findMany({
    where: { spaceId: input.spaceId, baselineId: null, upperKey: { in: sources } },
    select: { id: true, key: true, upperKey: true, status: true, originVersion: { select: { documentId: true } } },
  });

  const byUpper = new Map(rows.map((row) => [row.upperKey, row]));
  for (const pair of input.pairs) {
    const row = byUpper.get(upperKey(pair.from));
    if (!row) throw new NotFoundError(`${pair.from} is not a live requirement of this space.`);
    if (row.status === 'DELETED') {
      throw new ConflictError(`${pair.from} has been deleted; there is nothing to rename.`);
    }
  }

  // ---------------------------------------------------------------- 2. targets are free
  const targets = input.pairs.map((pair) => upperKey(pair.to));
  const renaming = new Set(sources);

  const taken = await tx.requirement.findMany({
    where: { spaceId: input.spaceId, baselineId: null, upperKey: { in: targets } },
    select: { upperKey: true },
  });
  for (const row of taken) {
    // A key being vacated by this same rename is free by the end of the transaction.
    if (!renaming.has(row.upperKey)) {
      throw new ConflictError(`${row.upperKey} is already used by another requirement in this space.`);
    }
  }

  // RD-051 — an alias still claims its key, so a link written before an earlier rename can
  // never later resolve to a different requirement that took the freed key.
  const claimed = await tx.requirementKeyAlias.findMany({
    where: { spaceId: input.spaceId, upperKey: { in: targets } },
    select: { upperKey: true, requirementId: true },
  });
  const renamingIds = new Set(rows.map((row) => row.id));
  for (const alias of claimed) {
    if (!renamingIds.has(alias.requirementId)) {
      throw new ConflictError(
        `${alias.upperKey} is the former key of another requirement, and reusing it would make old links point at the wrong one.`,
      );
    }
  }

  await check();

  // ------------------------------------------------- 3. the keys, in two phases (RD-054)
  // The partial unique index on (spaceId, upperKey) WHERE baselineId IS NULL is not
  // deferrable and Postgres checks it row by row, so a permutation — FN-1 → FN-2 and
  // FN-2 → FN-3 in the same batch — cannot be done in one pass.
  const plan = input.pairs.map((pair) => {
    const row = byUpper.get(upperKey(pair.from))!;
    return { row, from: row.key, to: pair.to.trim(), toUpper: upperKey(pair.to) };
  });

  for (const step of plan) {
    await tx.requirement.update({
      where: { id: step.row.id },
      data: { key: sentinelFor(step.row.id), upperKey: sentinelFor(step.row.id) },
    });
  }
  for (const step of plan) {
    await tx.requirement.update({
      where: { id: step.row.id },
      data: {
        key: step.to,
        upperKey: step.toUpper,
        renamedFrom: step.from,
        updatedById: input.actorId,
      },
    });
  }
  summary.renamed = plan.length;
  await hooks.progress?.(10, `${plan.length} renamed; propagating.`);

  // ------------------------------------------------------------------ 4. the alias chain
  // Aliases already pointing at these requirements stay put: that is what makes the chain
  // a chain, so FN-1 still resolves after FN-1 → FN-2 → FN-3.
  //
  // Two kinds of alias are cleared first. One claiming a key that is now *live* is stale:
  // the requirement wearing it answers for it. One claiming a key this batch is vacating
  // is being replaced by the row written below — which matters for a swap, where each
  // requirement takes a key the other has just given up and both have now held it. The
  // unique index allows one owner per historical key, so the most recent claim wins and
  // the older one is dropped; that ambiguity is exactly what the collision check above
  // prevents in every case except a swap inside a single batch, where it is unavoidable.
  await tx.requirementKeyAlias.deleteMany({
    where: {
      spaceId: input.spaceId,
      upperKey: { in: [...plan.map((step) => step.toUpper), ...plan.map((step) => upperKey(step.from))] },
    },
  });
  await tx.requirementKeyAlias.createMany({
    data: plan.map((step) => ({
      spaceId: input.spaceId,
      key: step.from,
      upperKey: upperKey(step.from),
      requirementId: step.row.id,
      actorId: input.actorId,
      jobId: input.jobId ?? null,
    })),
  });

  // spec 03 §4.2 step 3 — using a key advances its type's sequence and never rewinds it.
  await advanceSequencesForKeys(tx, input.spaceId, plan.map((step) => step.toUpper));

  await check();

  // -------------------------------------------------- 5. dependencies waiting on the key
  summary.unresolvedRewritten = await rewriteUnresolved(tx, input, plan);

  // --------------------------------------------------------------- 6. documents (RD-050)
  summary.documentsRewritten = await rewriteDocuments(tx, input, plan, hooks, check);

  await check();

  // ------------------------------------------------------------ 7. saved queries (RD-052)
  const queries = await rewriteSavedQueries(tx, input);
  summary.queriesRewritten = queries.rewritten;
  summary.queriesSkipped = queries.skipped;

  // --------------------------------------------------------------- 8. history and audit
  if (input.historyEnabled) {
    const entries: HistoryEntry[] = plan.map((step) => ({
      requirementId: step.row.id,
      spaceId: input.spaceId,
      actorId: input.actorId,
      changeKind: 'KEY_RENAMED' as const,
      before: { key: step.from },
      after: { key: step.to },
    }));
    await recordHistory(tx, entries);
  }

  // spec 07 §6 — a rename must be reconstructable from the audit log alone, so the whole
  // mapping goes in, not a count.
  await recordAuditEventIn(tx, {
    actorId: input.actorId,
    spaceId: input.spaceId,
    objectType: 'Requirement',
    objectId: input.jobId ?? plan[0]!.row.id,
    operation: 'rename',
    parameters: {
      jobId: input.jobId ?? null,
      pairs: plan.map((step) => ({ from: step.from, to: step.to })),
      documentsRewritten: summary.documentsRewritten,
      queriesRewritten: summary.queriesRewritten,
      queriesSkipped: summary.queriesSkipped,
    },
  });

  await hooks.progress?.(100, `${summary.renamed} renamed.`);
  return summary;
}

/**
 * `UnresolvedDependency.targetKey` is the one plain-text key column a rename must move.
 * Renaming *onto* a key others were waiting for is handled by the reindex that follows,
 * which promotes anything now resolvable.
 */
async function rewriteUnresolved(
  tx: Prisma.TransactionClient,
  input: RenameInput,
  plan: ReadonlyArray<{ from: string; to: string }>,
): Promise<number> {
  let moved = 0;
  for (const step of plan) {
    const updated = await tx.unresolvedDependency.updateMany({
      where: {
        targetSpaceKey: input.spaceKey,
        // A key is compared case-insensitively everywhere else (RD-001); a pending link
        // written as `fn-1` is waiting for the same requirement as one written `FN-1`.
        targetKey: { equals: step.from, mode: 'insensitive' },
        child: { spaceId: input.spaceId },
      },
      data: { targetKey: step.to },
    });
    moved += updated.count;
  }
  return moved;
}

/**
 * Rewrites every current document version that mentions a renamed key, and reindexes it.
 *
 * Discovery is a superset: the documents that define the renamed requirements, the ones
 * whose current version links them, and — for an embedded report's query, which no index
 * reaches — anything whose current content mentions the old key as text. `rewriteKeys`
 * then decides precisely, and a document it returns unchanged is never given a version.
 */
async function rewriteDocuments(
  tx: Prisma.TransactionClient,
  input: RenameInput,
  plan: ReadonlyArray<{ row: { id: string; originVersion: { documentId: string } | null }; from: string; to: string }>,
  hooks: RenameHooks,
  check: () => Promise<void>,
): Promise<number> {
  const documentIds = new Set<string>();
  for (const step of plan) {
    if (step.row.originVersion) documentIds.add(step.row.originVersion.documentId);
  }

  const links = await tx.documentLink.findMany({
    where: { requirementId: { in: plan.map((step) => step.row.id) } },
    select: { version: { select: { documentId: true, document: { select: { currentVersionId: true } }, id: true } } },
  });
  for (const link of links) {
    if (link.version.document.currentVersionId === link.version.id) documentIds.add(link.version.documentId);
  }

  // The text prefilter, for report queries and anything the indexes cannot see.
  for (const step of plan) {
    const mentions = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT d."id"
        FROM "Document" d
        JOIN "DocumentVersion" v ON v."id" = d."currentVersionId"
       WHERE d."spaceId" = ${input.spaceId}
         AND d."deletedAt" IS NULL
         AND v."content"::text ILIKE ${'%' + step.from + '%'}
    `;
    for (const row of mentions) documentIds.add(row.id);
  }

  if (documentIds.size > RENAME_MAX_DOCUMENTS) {
    throw new ValidationError(
      `A rename rewrites at most ${RENAME_MAX_DOCUMENTS.toLocaleString()} documents at a time; this one reaches ${documentIds.size.toLocaleString()}.`,
    );
  }

  const pairs = plan.map((step) => ({ from: step.from, to: step.to }));
  const types = await listTypesWithRules(input.spaceId);
  const ids = [...documentIds];
  let rewritten = 0;

  for (let index = 0; index < ids.length; index += 1) {
    await check();
    const documentId = ids[index]!;

    const document = await tx.document.findFirst({
      where: { id: documentId, spaceId: input.spaceId, deletedAt: null },
      select: { id: true, currentVersionId: true },
    });
    if (!document?.currentVersionId) continue;

    const current = await tx.documentVersion.findUnique({
      where: { id: document.currentVersionId },
      select: { content: true },
    });
    if (!current) continue;

    const outcome = rewriteKeys(current.content, pairs, input.spaceKey);
    if (outcome.changed === 0) continue;

    const content = outcome.content as PMNode;
    const indexed = indexDocumentVersion({
      content,
      space: {
        key: input.spaceKey,
        types: types.map((type) => ({
          id: type.id,
          name: type.name,
          keyPattern: type.keyPattern,
          locked: type.locked,
        })),
      },
    });

    await writeDocumentVersion(tx, {
      documentId: document.id,
      content,
      authorId: input.actorId,
      message: renameMessage(pairs),
      onVersion: async (inner, version) => {
        await applyIndexResult(inner, {
          spaceId: input.spaceId,
          spaceKey: input.spaceKey,
          isolated: input.isolated,
          documentId: document.id,
          versionId: version.id,
          actorId: input.actorId,
          result: indexed,
          types: types.map((type) => ({ id: type.id, rules: rulesOf(type) })),
          // The rename writes its own KEY_RENAMED row; letting the reindex write history
          // too would record a second, contentless change against every requirement in
          // every document it touched.
          historyEnabled: false,
        });
      },
    });

    rewritten += 1;
    const percent = 10 + Math.round(((index + 1) / ids.length) * 80);
    await hooks.progress?.(percent, `${rewritten} of ${ids.length} documents rewritten.`);
  }

  return rewritten;
}

function renameMessage(pairs: ReadonlyArray<{ from: string; to: string }>): string {
  const first = pairs[0];
  if (!first) return 'Renamed';
  if (pairs.length === 1) return `Renamed ${first.from} to ${first.to}`;
  return `Renamed ${pairs.length} requirements, ${first.from} to ${first.to} among them`;
}

/**
 * spec 03 §5 — "every saved matrix query that references the key literally".
 * `Baseline.sourceQuery` is deliberately absent: it records which query a frozen snapshot
 * was taken with, and rewriting it would change the provenance of a baseline (RD-052).
 */
async function rewriteSavedQueries(
  tx: Prisma.TransactionClient,
  input: RenameInput,
): Promise<{ rewritten: number; skipped: string[] }> {
  const mapping = buildMapping(input.pairs);
  let rewritten = 0;
  const skipped: string[] = [];

  const matrices = await tx.savedMatrix.findMany({
    where: { spaceId: input.spaceId },
    select: { id: true, name: true, query: true },
  });
  for (const matrix of matrices) {
    const result = rewriteKeyLiterals(matrix.query, mapping);
    if (!result.ok) {
      skipped.push(`matrix “${matrix.name}”`);
      continue;
    }
    if (result.changed === 0) continue;
    await tx.savedMatrix.update({ where: { id: matrix.id }, data: { query: result.query } });
    rewritten += 1;
  }

  const searches = await tx.savedSearch.findMany({
    where: { spaceId: input.spaceId },
    select: { id: true, name: true, query: true },
  });
  for (const search of searches) {
    const result = rewriteKeyLiterals(search.query, mapping);
    if (!result.ok) {
      skipped.push(`saved search “${search.name}”`);
      continue;
    }
    if (result.changed === 0) continue;
    await tx.savedSearch.update({ where: { id: search.id }, data: { query: result.query } });
    rewritten += 1;
  }

  return { rewritten, skipped };
}

/**
 * Resolves a key that may be a former one. RD-051 — a link written before a rename, and a
 * key read off a frozen baseline, both still land on the requirement they named.
 */
export async function resolveKeyAlias(
  spaceId: string,
  key: string,
): Promise<{ requirementId: string; currentKey: string; formerKey: string } | null> {
  const upper = upperKey(key);

  // A live requirement wearing the key answers for it. After a swap the alias table can
  // still hold a row for a key that is live again, and following it would send the reader
  // to the wrong requirement.
  const live = await prisma.requirement.findFirst({
    where: { spaceId, baselineId: null, upperKey: upper },
    select: { id: true },
  });
  if (live) return null;

  const alias = await prisma.requirementKeyAlias.findUnique({
    where: { spaceId_upperKey: { spaceId, upperKey: upper } },
    select: { key: true, requirement: { select: { id: true, key: true, baselineId: true } } },
  });
  if (!alias || alias.requirement.baselineId !== null) return null;
  return { requirementId: alias.requirement.id, currentKey: alias.requirement.key, formerKey: alias.key };
}

/** Every former key of a requirement, newest first — the chain RD-007 promises. */
export async function formerKeys(requirementId: string): Promise<string[]> {
  const aliases = await prisma.requirementKeyAlias.findMany({
    where: { requirementId },
    orderBy: { renamedAt: 'desc' },
    select: { key: true },
  });
  return aliases.map((alias) => alias.key);
}

/**
 * Former upper-cased key → current upper-cased key, for every requirement named on either
 * side of a comparison. A key that a live requirement currently wears is left out: it
 * answers for itself, and after a swap the alias table can still hold a stale row for it.
 *
 * spec: 05-baselines-and-diff.md §5.2 step 1 (pairing); RD-007, RD-051.
 */
export async function aliasMapFor(
  spaceId: string,
  keys: readonly string[],
): Promise<Map<string, string>> {
  const uppers = [...new Set(keys.map((key) => key.toUpperCase()))];
  if (uppers.length === 0) return new Map();

  const [aliases, live] = await Promise.all([
    prisma.requirementKeyAlias.findMany({
      where: { spaceId, upperKey: { in: uppers } },
      select: { upperKey: true, requirement: { select: { upperKey: true, baselineId: true } } },
    }),
    prisma.requirement.findMany({
      where: { spaceId, baselineId: null, upperKey: { in: uppers } },
      select: { upperKey: true },
    }),
  ]);

  const liveKeys = new Set(live.map((row) => row.upperKey));
  const map = new Map<string, string>();
  for (const alias of aliases) {
    if (liveKeys.has(alias.upperKey)) continue;
    if (alias.requirement.baselineId !== null) continue;
    map.set(alias.upperKey, alias.requirement.upperKey);
  }
  return map;
}
