import type { JobHandler, JobOutcome } from '../runner';

/**
 * The rename job. spec: 03-authoring-and-indexing.md §5 —
 * "one job, one database transaction, full rollback on any error".
 *
 * This is the first handler that is a single transaction, so unlike the exports and the
 * freeze it does not page: there is nothing to stream, and a page source is read outside
 * any transaction. The whole rename is one call into the injected writer, which owns the
 * transaction. Progress is reported through the job row on its own connection, so the bar
 * still moves while the transaction is open and a rollback does not erase the record that
 * the attempt happened.
 */

export type RenamePayload = {
  spaceId: string;
  spaceKey: string;
  actorId: string;
  pairs: Array<{ from: string; to: string }>;
};

export type RenameResult = {
  renamed: number;
  documentsRewritten: number;
  queriesRewritten: number;
  queriesSkipped: string[];
  unresolvedRewritten: number;
};

export type RenameWriter = {
  rename: (
    payload: RenamePayload,
    jobId: string,
    hooks: { cancelled: () => Promise<boolean>; progress: (percent: number, message: string) => Promise<void> },
  ) => Promise<RenameResult | 'cancelled'>;
};

let writer: RenameWriter | null = null;

/** Injected in `jobs/register.ts`, so the handler itself imports no repository. */
export function setRenameWriter(next: RenameWriter): void {
  writer = next;
}

export function describeRename(result: RenameResult): string {
  const parts = [`${result.renamed} renamed`, `${result.documentsRewritten} documents rewritten`];
  if (result.queriesRewritten > 0) parts.push(`${result.queriesRewritten} saved queries updated`);
  if (result.unresolvedRewritten > 0) parts.push(`${result.unresolvedRewritten} pending links repointed`);
  if (result.queriesSkipped.length > 0) {
    parts.push(`${result.queriesSkipped.length} could not be parsed and were left alone: ${result.queriesSkipped.join(', ')}`);
  }
  return `${parts.join('; ')}.`;
}

export const renameHandler: JobHandler<RenamePayload, never> = async (payload, context): Promise<JobOutcome> => {
  if (!writer) throw new Error('No rename writer is registered.');

  await context.progress(1, 'Checking the new keys.');
  const result = await writer.rename(payload, context.jobId, {
    cancelled: context.cancelled,
    progress: context.progress,
  });

  // A cancelled rename rolled its transaction back, so there is nothing to undo and
  // nothing was saved — the same guarantee as a failure.
  if (result === 'cancelled') return { cancelled: true };

  await context.progress(100, describeRename(result));
  return {};
};
