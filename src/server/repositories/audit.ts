import type { Prisma } from '@prisma/client';
import { prisma } from './client';

/**
 * The audit log. spec: 07-permissions-and-limits.md §6 — "Every state-changing operation
 * writes an audit row: actor, at, object, operation, parameters", append-only and never
 * pruned by the history retention policy. Freeze, refreeze, **rename**, restriction change,
 * permission change and export are the operations an auditor will ask about, and each must
 * be reconstructable from the audit log alone.
 */
export type AuditInput = {
  actorId: string;
  /** Null for instance-wide objects: groups, classification levels (RD-062). */
  spaceId: string | null;
  objectType: string;
  objectId: string;
  operation: string;
  parameters: Prisma.InputJsonValue;
};

export async function recordAuditEvent(input: AuditInput): Promise<void> {
  await prisma.auditEvent.create({ data: input });
}

/**
 * The same row, written inside a transaction the caller owns. A rename's audit row belongs
 * to the rename: if the transaction rolls back there was no rename to audit.
 */
export async function recordAuditEventIn(tx: Prisma.TransactionClient, input: AuditInput): Promise<void> {
  await tx.auditEvent.create({ data: input });
}

export type AuditFilter = {
  spaceId: string;
  operation?: string;
  actorId?: string;
  since?: Date;
  until?: Date;
  limit?: number;
};

/**
 * The audit log of one space, newest first, with actor names. spec 07 §6; RD-062. Rows
 * carry identifiers and parameters, never requirement text, so the reader needs ADMIN, not
 * visibility of every document an entry mentions.
 */
export async function listAuditEvents(filter: AuditFilter) {
  const rows = await prisma.auditEvent.findMany({
    where: {
      spaceId: filter.spaceId,
      ...(filter.operation ? { operation: filter.operation } : {}),
      ...(filter.actorId ? { actorId: filter.actorId } : {}),
      ...(filter.since || filter.until
        ? { at: { ...(filter.since ? { gte: filter.since } : {}), ...(filter.until ? { lte: filter.until } : {}) } }
        : {}),
    },
    orderBy: { at: 'desc' },
    take: Math.min(filter.limit ?? 200, 1_000),
  });
  const actors = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.actorId))] } },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  return rows.map((row) => ({ ...row, actor: byId.get(row.actorId) ?? null }));
}

export async function listAuditOperations(spaceId: string): Promise<string[]> {
  const rows = await prisma.auditEvent.findMany({
    where: { spaceId },
    distinct: ['operation'],
    select: { operation: true },
    orderBy: { operation: 'asc' },
  });
  return rows.map((row) => row.operation);
}
