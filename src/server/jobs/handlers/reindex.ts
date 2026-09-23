import type { JobHandler } from '../runner';

/**
 * The reindex job. spec: 08-api-surface.md §3 — `POST …/documents/{id}/reindex` "returns a
 * job"; RD-070. One document, one transaction, no pages.
 */
export type ReindexPayload = { spaceKey: string; documentId: string };

export type ReindexOutcome = { created: string[]; updated: string[]; deleted: string[]; diagnostics: unknown[] };

let reindex: ((payload: ReindexPayload & { actorId: string }) => Promise<ReindexOutcome>) | null = null;

/** Injected from `register.ts`, which is where the use case layer is wired in. */
export function setReindexRunner(runner: typeof reindex): void {
  reindex = runner;
}

export const reindexHandler: JobHandler<ReindexPayload & { actorId?: string }, never> = async (payload, context) => {
  if (!reindex) throw new Error('No reindex runner is registered.');
  await context.progress(1, 'Reindexing.');
  if (!payload.actorId) throw new Error('A reindex job must record who queued it.');
  const outcome = await reindex({ ...payload, actorId: payload.actorId });
  const errors = outcome.diagnostics.filter(
    (diagnostic) => typeof diagnostic === 'object' && diagnostic !== null && (diagnostic as { severity?: unknown }).severity === 'error',
  ).length;
  await context.progress(
    100,
    `${outcome.created.length} new, ${outcome.updated.length} updated, ${outcome.deleted.length} removed; ${errors} error${errors === 1 ? '' : 's'}.`,
  );
  return {};
};
