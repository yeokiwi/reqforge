import type { ExternalPropertyDefinition } from '@prisma/client';
import { ConflictError, NotFoundError } from '@/domain/errors';
import {
  externalTypeMap,
  type DataType,
  type ExternalDefinition,
  type ExternalTypeMap,
} from '@/domain/properties/external';
import { prisma } from './client';
import { recordHistoryDirect } from './history';

/**
 * External property definitions and the values filed against them.
 * spec: 01-domain-model.md (Property, ExternalPropertyDefinition); 04 §2.2
 *
 * Definitions are instance-global (research §2.6), so nothing here is space-scoped —
 * the space check happens in the usecase, on the requirements being written.
 */

function toDefinition(row: ExternalPropertyDefinition): ExternalDefinition {
  return {
    id: row.id,
    name: row.name,
    searchName: row.name.toLowerCase(),
    dataType: row.dataType,
    enumValues: row.enumValues,
    description: row.description,
  };
}

export async function listDefinitions(): Promise<ExternalDefinition[]> {
  const rows = await prisma.externalPropertyDefinition.findMany({ orderBy: { name: 'asc' } });
  return rows.map(toDefinition);
}

/** The declared types as the query engine takes them (RD-037). */
export async function loadExternalTypes(): Promise<ExternalTypeMap> {
  return externalTypeMap(await listDefinitions());
}

export async function findDefinition(id: string): Promise<ExternalDefinition | null> {
  const row = await prisma.externalPropertyDefinition.findUnique({ where: { id } });
  return row ? toDefinition(row) : null;
}

export async function findDefinitionByName(name: string): Promise<ExternalDefinition | null> {
  const row = await prisma.externalPropertyDefinition.findFirst({
    where: { name: { equals: name.trim(), mode: 'insensitive' } },
  });
  return row ? toDefinition(row) : null;
}

export async function countValues(definitionId: string): Promise<number> {
  return prisma.property.count({ where: { definitionId, kind: 'EXTERNAL' } });
}

/** How many values each definition carries — the admin list shows it beside every row. */
export async function countValuesByDefinition(): Promise<Map<string, number>> {
  const rows = await prisma.property.groupBy({
    by: ['definitionId'],
    where: { kind: 'EXTERNAL' },
    _count: { _all: true },
  });

  return new Map(
    rows.flatMap((row) => (row.definitionId ? [[row.definitionId, row._count._all] as const] : [])),
  );
}

export async function createDefinition(input: {
  name: string;
  dataType: DataType;
  enumValues: string[];
  description: string | null;
}): Promise<ExternalDefinition> {
  const row = await prisma.externalPropertyDefinition.create({ data: input });
  return toDefinition(row);
}

export async function updateDefinition(
  id: string,
  input: { name: string; dataType: DataType; enumValues: string[]; description: string | null },
): Promise<ExternalDefinition> {
  const row = await prisma.externalPropertyDefinition.update({ where: { id }, data: input });
  // The display name is stored on every value row as well, so a rename carries across.
  await prisma.property.updateMany({
    where: { definitionId: id, kind: 'EXTERNAL' },
    data: { name: input.name, searchName: input.name.toLowerCase() },
  });
  return toDefinition(row);
}

/** spec 01 — "Deletion is refused while values exist." */
export async function deleteDefinition(id: string): Promise<void> {
  const definition = await prisma.externalPropertyDefinition.findUnique({ where: { id } });
  if (!definition) throw new NotFoundError('That property definition no longer exists.');

  const used = await countValues(id);
  if (used > 0) {
    throw new ConflictError(
      `"${definition.name}" still holds ${used} value${used === 1 ? '' : 's'}. Clear them before deleting it.`,
    );
  }
  await prisma.externalPropertyDefinition.delete({ where: { id } });
}

export type ExternalValue = { requirementId: string; definitionId: string; value: string };

/** One batched read for a page of rows — the matrix never fetches per row (spec 04 §2.5). */
export async function fetchValuesFor(
  requirementIds: readonly string[],
  definitionIds: readonly string[],
): Promise<ExternalValue[]> {
  if (requirementIds.length === 0 || definitionIds.length === 0) return [];

  const rows = await prisma.property.findMany({
    where: {
      requirementId: { in: [...requirementIds] },
      definitionId: { in: [...definitionIds] },
      kind: 'EXTERNAL',
    },
    select: { requirementId: true, definitionId: true, value: true },
  });

  return rows.flatMap((row) =>
    row.definitionId ? [{ requirementId: row.requirementId, definitionId: row.definitionId, value: row.value }] : [],
  );
}

export async function valuesOfRequirement(requirementId: string): Promise<ExternalValue[]> {
  return fetchValuesFor([requirementId], (await listDefinitions()).map((definition) => definition.id));
}

/**
 * Sets one external value across many requirements in a single statement — a bulk set
 * over a whole result set is one round trip, not one per row (spec 04 §2.2).
 *
 * `value === null` clears. Baselined rows are skipped: a frozen requirement is immutable
 * (invariant R2) and external values are not part of a baseline in the first place.
 * Returns how many rows were written.
 */
export async function setValueForRequirements(input: {
  requirementIds: readonly string[];
  definition: Pick<ExternalDefinition, 'id' | 'name' | 'searchName'>;
  value: string | null;
  /** spec 05 §6 — an approval value changing is one of the things an auditor asks about. */
  actorId?: string;
  historyEnabled?: boolean;
}): Promise<number> {
  const ids = [...new Set(input.requirementIds)];
  if (ids.length === 0) return 0;

  if (input.historyEnabled && input.actorId) await recordExternalChange(ids, input);

  if (input.value === null) {
    const cleared = await prisma.property.deleteMany({
      where: { requirementId: { in: ids }, definitionId: input.definition.id, kind: 'EXTERNAL' },
    });
    return cleared.count;
  }

  // ON CONFLICT infers the partial unique index of invariant E2, so setting a value that
  // is already there replaces it rather than adding a second one (RD-038).
  return prisma.$executeRaw`
    INSERT INTO "Property" (
      "id", "requirementId", "kind", "name", "searchName", "value",
      "valueOrdinal", "valueIndex", "definitionId"
    )
    SELECT gen_random_uuid()::text, r.id, 'EXTERNAL'::"PropertyKind",
           ${input.definition.name}, ${input.definition.searchName}, ${input.value},
           0, 0, ${input.definition.id}
    FROM "Requirement" r
    WHERE r.id = ANY(${ids}) AND r."baselineId" IS NULL
    ON CONFLICT ("requirementId", "definitionId") WHERE "kind" = 'EXTERNAL'
    DO UPDATE SET "value" = EXCLUDED."value",
                  "name" = EXCLUDED."name",
                  "searchName" = EXCLUDED."searchName"
  `;
}

/**
 * History for an external value, written before the change so the `before` is the truth.
 * spec: 05-baselines-and-diff.md §6 (`EXTERNAL_PROPERTY`), RD-048
 */
async function recordExternalChange(
  ids: readonly string[],
  input: {
    definition: Pick<ExternalDefinition, 'id' | 'name'>;
    value: string | null;
    actorId?: string;
  },
): Promise<void> {
  if (!input.actorId) return;

  const rows = await prisma.requirement.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true,
      spaceId: true,
      properties: { where: { definitionId: input.definition.id, kind: 'EXTERNAL' }, select: { value: true } },
    },
  });

  await recordHistoryDirect(
    rows.map((row) => ({
      requirementId: row.id,
      spaceId: row.spaceId,
      actorId: input.actorId!,
      changeKind: 'EXTERNAL_PROPERTY' as const,
      before: { name: input.definition.name, value: row.properties[0]?.value ?? null },
      after: { name: input.definition.name, value: input.value },
    })),
  );
}
