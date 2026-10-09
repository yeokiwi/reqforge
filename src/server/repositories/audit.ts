// The audit log (spec 07 §6): append-only, never pruned. Nothing in the repository layer
// updates or deletes AuditEvent rows.
import type { Prisma } from "@prisma/client";
import { clientOf } from "./internal";
import type { Db } from "./transaction";

export interface AuditEntry {
  readonly actorId: string;
  /** Null for instance-level operations. */
  readonly spaceId: string | null;
  /** e.g. "page", "version", "attachment". */
  readonly objectType: string;
  readonly objectId: string;
  /** e.g. "create", "publish", "rename", "move", "delete". */
  readonly operation: string;
  /** JSON-serialisable; `undefined` members are dropped. Enough to reconstruct the operation. */
  readonly parameters: Readonly<Record<string, unknown>>;
  /** Defaults to now. */
  readonly at?: Date;
}

/**
 * Appends one audit row. Call it with the transaction that made the change, so the change and
 * its record commit or roll back together.
 */
// spec: docs/specs/07-permissions-and-limits.md section 6 (every state-changing operation writes an audit row: actor, at, object, operation, parameters)
export async function writeAudit(db: Db, entry: AuditEntry): Promise<{ readonly id: string }> {
  const parameters = JSON.parse(JSON.stringify(entry.parameters)) as Prisma.InputJsonObject;
  const row = await clientOf(db).auditEvent.create({
    data: {
      actorId: entry.actorId,
      spaceId: entry.spaceId,
      objectType: entry.objectType,
      objectId: entry.objectId,
      operation: entry.operation,
      parameters,
      ...(entry.at ? { at: entry.at } : {}),
    },
    select: { id: true },
  });
  return { id: row.id };
}
