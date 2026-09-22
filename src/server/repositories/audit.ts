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
  spaceId: string;
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
