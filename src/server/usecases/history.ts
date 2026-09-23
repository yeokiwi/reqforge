import { ValidationError } from '@/domain/errors';
import { requireSpace } from '@/server/authz';
import { recordAuditEvent } from '@/server/repositories/audit';
import { pruneHistory, type PruneOutcome } from '@/server/repositories/history';
import { setHistorySettings } from '@/server/repositories/spaces';

/**
 * History settings and retention. spec: 05-baselines-and-diff.md §6; 07 §2.1 (ADMIN);
 * 07 §6 / RD-062 — both are audited, because retention decides what an auditor can read.
 */
export async function saveHistorySettingsUseCase(
  spaceKey: string,
  input: { enabled: boolean; retentionDays: unknown },
): Promise<void> {
  const { space, user } = await requireSpace(spaceKey, 'ADMIN');

  const raw = input.retentionDays;
  const days = typeof raw === 'string' && raw.trim().length > 0 ? Number(raw) : null;
  if (days !== null && (!Number.isInteger(days) || days < 1)) {
    throw new ValidationError('Retention is a whole number of days, or blank to keep history for ever.');
  }

  await setHistorySettings(space.id, { enabled: input.enabled, retentionDays: days });
  await recordAuditEvent({
    actorId: user.id,
    spaceId: space.id,
    objectType: 'Space',
    objectId: space.id,
    operation: 'history-settings',
    parameters: {
      from: { enabled: space.historyEnabled, retentionDays: space.historyRetentionDays },
      to: { enabled: input.enabled, retentionDays: days },
    },
  });
}

/** Runs retention now. `RD-049` decides what it may not touch. */
export async function pruneHistoryUseCase(spaceKey: string): Promise<PruneOutcome> {
  const { space, user } = await requireSpace(spaceKey, 'ADMIN');
  if (!space.historyRetentionDays) {
    throw new ValidationError('Set a retention period first; without one, history is kept for ever.');
  }
  const outcome = await pruneHistory(space.id, space.historyRetentionDays);
  await recordAuditEvent({
    actorId: user.id,
    spaceId: space.id,
    objectType: 'Space',
    objectId: space.id,
    operation: 'history-prune',
    parameters: { retentionDays: space.historyRetentionDays, ...outcome },
  });
  return outcome;
}
