import type { Job } from '@prisma/client';
import { ForbiddenError, NotFoundError, ValidationError } from '@/domain/errors';
import {
  decompose,
  planRename,
  previewRows,
  RENAME_MAX_REQUIREMENTS,
  type RenamePlan,
  type RenameRow,
} from '@/domain/keys/rename';
import { requireSpace } from '@/server/authz';
import { registerJobHandlers } from '@/server/jobs/register';
import { jobsRunInline, runJobNow } from '@/server/jobs/runner';
import { acknowledgeJob, enqueueJob, findJob } from '@/server/repositories/jobs';
import { listLiveKeys, lockedPatternsOf } from '@/server/repositories/requirements';
import { formerKeys, resolveKeyAlias } from '@/server/repositories/rename';

/**
 * Renaming requirement keys.
 * spec: 03-authoring-and-indexing.md §5.
 *
 * `RD-053` — renaming needs `ADMIN`. Requirement Yogi restricts it to a global
 * administrator or an explicitly granted group (research §2.8), and a key is a
 * requirement's identity: of the four things CLAUDE.md calls expensive to undo, this
 * touches the first.
 */

export type RenamePreview = {
  decomposition: { prefix: string; middles: string[]; suffix: string };
  rows: RenameRow[];
  remainder: number;
  problems: number;
  runnable: number;
};

function cleanKeys(input: unknown): string[] {
  if (!Array.isArray(input)) throw new ValidationError('Select the requirements to rename first.');
  const keys = input.filter((value): value is string => typeof value === 'string').map((value) => value.trim());
  const unique = [...new Set(keys.filter((key) => key.length > 0))];
  if (unique.length === 0) throw new ValidationError('Select the requirements to rename first.');
  if (unique.length > RENAME_MAX_REQUIREMENTS) {
    throw new ValidationError(
      `A rename covers at most ${RENAME_MAX_REQUIREMENTS.toLocaleString()} requirements at a time; ${unique.length.toLocaleString()} are selected.`,
    );
  }
  return unique;
}

/** The decomposition the batch screen opens with. spec 03 §5 (batch rename). */
export async function renameSelectionUseCase(spaceKey: string, keys: unknown): Promise<{
  keys: string[];
  decomposition: { prefix: string; middles: string[]; suffix: string };
}> {
  await requireSpace(spaceKey, 'ADMIN');
  const clean = cleanKeys(keys);
  return { keys: clean, decomposition: decompose(clean) };
}

/**
 * Validates a whole batch before anything is written, and returns at most 50 rows with a
 * count of the remainder. spec 03 §5 — "The preview lists at most 50 with a count of the
 * remainder."
 */
export async function previewRenameUseCase(input: {
  spaceKey: string;
  pairs: unknown;
}): Promise<RenamePreview> {
  const { space } = await requireSpace(input.spaceKey, 'ADMIN');
  const pairs = cleanPairs(input.pairs);

  const plan = planRename({ pairs, lockedPatterns: await lockedPatternsOf(space.id) });
  const withCollisions = await markExistingKeys(space.id, plan);
  const preview = previewRows(withCollisions);

  return {
    decomposition: decompose(pairs.map((pair) => pair.from)),
    rows: preview.rows,
    remainder: preview.remainder,
    problems: withCollisions.problems,
    runnable: withCollisions.pairs.length,
  };
}

function cleanPairs(input: unknown): Array<{ from: string; to: string }> {
  if (!Array.isArray(input)) throw new ValidationError('Nothing was selected to rename.');
  const pairs = input.flatMap((value) => {
    if (typeof value !== 'object' || value === null) return [];
    const { from, to } = value as { from?: unknown; to?: unknown };
    if (typeof from !== 'string' || typeof to !== 'string') return [];
    const trimmed = { from: from.trim(), to: to.trim() };
    return trimmed.from.length > 0 ? [trimmed] : [];
  });
  if (pairs.length === 0) throw new ValidationError('Nothing was selected to rename.');
  if (pairs.length > RENAME_MAX_REQUIREMENTS) {
    throw new ValidationError(
      `A rename covers at most ${RENAME_MAX_REQUIREMENTS.toLocaleString()} requirements at a time; this one covers ${pairs.length.toLocaleString()}.`,
    );
  }
  return pairs;
}

/**
 * A target already worn by a requirement this rename is not moving, or still claimed by an
 * earlier rename's alias, is a collision the reader should see in the preview rather than
 * discover when the job fails (`RD-051`).
 */
async function markExistingKeys(spaceId: string, plan: RenamePlan): Promise<RenamePlan> {
  const targets = plan.pairs.map((pair) => pair.to);
  if (targets.length === 0) return plan;

  const sources = new Set(plan.rows.map((row) => row.from.toUpperCase()));
  const { live, aliased } = await listLiveKeys(spaceId, targets);

  const rows = plan.rows.map((row) => {
    if (row.problem !== undefined) return row;
    const upper = row.to.toUpperCase();
    if (live.has(upper) && !sources.has(upper)) {
      return { ...row, problem: 'DUPLICATE_TARGET' as const, message: 'Another requirement in this space already has this key.' };
    }
    if (aliased.has(upper) && !sources.has(upper)) {
      return {
        ...row,
        problem: 'DUPLICATE_TARGET' as const,
        message: 'This was another requirement’s key; reusing it would make old links point at the wrong one.',
      };
    }
    return row;
  });

  return {
    rows,
    pairs: rows.filter((row) => row.problem === undefined).map((row) => ({ from: row.from, to: row.to })),
    problems: rows.filter((row) => row.problem !== undefined).length,
  };
}

/** spec 03 §5 — one job, one transaction, progress with cancel. */
export async function startRenameUseCase(input: { spaceKey: string; pairs: unknown }): Promise<Job> {
  const { space, user } = await requireSpace(input.spaceKey, 'ADMIN');
  const pairs = cleanPairs(input.pairs);

  const plan = await markExistingKeys(space.id, planRename({ pairs, lockedPatterns: await lockedPatternsOf(space.id) }));
  if (plan.problems > 0) {
    const first = plan.rows.find((row) => row.problem !== undefined);
    throw new ValidationError(first?.message ?? 'Some of these keys cannot be used.');
  }
  if (plan.pairs.length === 0) throw new ValidationError('None of these keys would change.');

  registerJobHandlers();

  const job = await enqueueJob({
    kind: 'rename-key',
    spaceId: space.id,
    actorId: user.id,
    payload: { spaceId: space.id, spaceKey: space.key, actorId: user.id, pairs: plan.pairs },
  });

  if (jobsRunInline()) await runJobNow(job.id);
  return (await findJob(job.id)) ?? job;
}

/** spec 03 §5 — "an explicit acknowledge step". */
export async function acknowledgeRenameUseCase(spaceKey: string, jobId: string): Promise<void> {
  const { space, user } = await requireSpace(spaceKey, 'ADMIN');
  const job = await findJob(jobId);
  if (!job || job.spaceId !== space.id) throw new NotFoundError('That job does not exist in this space.');
  if (job.actorId !== user.id) throw new ForbiddenError('Only the person who ran a rename can acknowledge it.');
  await acknowledgeJob(jobId);
}

/**
 * Resolves a key that may be a former one, so a link written before a rename still lands.
 * `RD-051`; spec 03 §5.
 */
export async function resolveRenamedKey(spaceId: string, key: string) {
  return resolveKeyAlias(spaceId, key);
}

export async function formerKeysOf(requirementId: string): Promise<string[]> {
  return formerKeys(requirementId);
}
