import { ValidationError } from '@/domain/errors';
import { requireSpace } from '@/server/authz';
import { listAuditEvents, listAuditOperations } from '@/server/repositories/audit';
import { findUserByEmail } from '@/server/repositories/memberships';

/** spec 07 §6 — the audit log, for space ADMIN (RD-062). */
export async function auditLogUseCase(
  spaceKey: string,
  filter: { operation?: string; actorEmail?: string; since?: string; until?: string },
) {
  const { space } = await requireSpace(spaceKey, 'ADMIN');

  const date = (raw: string | undefined, name: string): Date | undefined => {
    if (!raw) return undefined;
    const value = new Date(raw);
    if (Number.isNaN(value.getTime())) throw new ValidationError(`“${name}” is not a date.`);
    return value;
  };

  const actor = filter.actorEmail ? await findUserByEmail(filter.actorEmail) : null;
  if (filter.actorEmail && !actor) return { events: [], operations: await listAuditOperations(space.id) };

  const [events, operations] = await Promise.all([
    listAuditEvents({
      spaceId: space.id,
      ...(filter.operation ? { operation: filter.operation } : {}),
      ...(actor ? { actorId: actor.id } : {}),
      ...(filter.since ? { since: date(filter.since, 'since') } : {}),
      ...(filter.until ? { until: date(filter.until, 'until') } : {}),
      limit: 500,
    }),
    listAuditOperations(space.id),
  ]);
  return { events, operations };
}
