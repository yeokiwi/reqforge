import type { Prisma, RequirementType, RequirementTypeRule, TemplateColumn as TemplateColumnRow } from '@prisma/client';
import { numberOf, parsePattern } from '@/domain/keys/pattern';
import { parseRules, parseTemplateColumns, type Rule, type TemplateColumn } from '@/domain/validation';
import { prisma } from './client';
import { param, render, sql, substituteAlias } from '@/domain/ryql/sql';
import { requirementVisibility, SYSTEM, type ReaderScope } from './visibility';

export async function listRequirementTypes(spaceId: string): Promise<RequirementType[]> {
  return prisma.requirementType.findMany({ where: { spaceId }, orderBy: { keyPattern: 'asc' } });
}

export async function findRequirementType(spaceId: string, typeId: string): Promise<RequirementType | null> {
  return prisma.requirementType.findFirst({ where: { id: typeId, spaceId } });
}

/**
 * Every key the space has ever used, including `DELETED` rows and every baseline.
 * spec: 03-authoring-and-indexing.md §4.2 — the sequence must not rewind when a key is
 * deleted, so deleted and baselined keys still count towards "highest existing number".
 */
export async function listAllKeys(spaceId: string): Promise<string[]> {
  // X3-exempt: keys only, for suggestion and uniqueness, which are space-wide.
  const rows = await prisma.requirement.findMany({
    where: { spaceId },
    select: { upperKey: true },
    distinct: ['upperKey'],
  });
  return rows.map((row) => row.upperKey);
}

/**
 * Keys that block reuse even when `preventReusingDeletedKeys` is off: every live row that
 * is not `DELETED`, plus every key captured in a baseline. A baselined key names a frozen
 * requirement forever (invariant R2), so it is never handed out again.
 * spec: 03-authoring-and-indexing.md §4.2; RD-026
 */
export async function listKeysExcludingDeleted(spaceId: string): Promise<string[]> {
  // X3-exempt: keys only, for the sequence reset, which is space-wide.
  const rows = await prisma.requirement.findMany({
    where: { spaceId, OR: [{ baselineId: { not: null } }, { status: { not: 'DELETED' } }] },
    select: { upperKey: true },
    distinct: ['upperKey'],
  });
  return rows.map((row) => row.upperKey);
}

/**
 * Advance-and-never-rewind: using a key moves its type's sequence past it.
 * spec: 03-authoring-and-indexing.md §4.2 step 3 (research §2.3)
 */
export async function advanceSequencesForKeys(
  tx: Prisma.TransactionClient,
  spaceId: string,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;
  const types = await tx.requirementType.findMany({ where: { spaceId } });

  for (const type of types) {
    const parsed = parsePattern(type.keyPattern);
    if (!parsed.ok) continue;

    const highest = keys.reduce((max, key) => Math.max(max, numberOf(parsed.pattern, key) ?? 0), 0);
    if (highest + 1 > type.nextSequence) {
      await tx.requirementType.update({ where: { id: type.id }, data: { nextSequence: highest + 1 } });
    }
  }
}

export async function setNextSequence(typeId: string, nextSequence: number): Promise<RequirementType> {
  return prisma.requirementType.update({ where: { id: typeId }, data: { nextSequence } });
}

/** The keys used most recently in a document, newest occurrence first. */
export async function keysUsedInDocument(spaceId: string, documentId: string): Promise<string[]> {
  // X3-exempt: keys only, for suggestion and uniqueness, which are space-wide.
  const rows = await prisma.requirement.findMany({
    where: { spaceId, baselineId: null, originVersion: { documentId } },
    orderBy: { updatedAt: 'desc' },
    select: { upperKey: true },
    take: 20,
  });
  return rows.map((row) => row.upperKey);
}

// ------------------------------------------------------------------ slice 12: rules

export type TypeWithRules = RequirementType & {
  rules: RequirementTypeRule[];
  templateColumns: TemplateColumnRow[];
};

/** A type and everything validation and templating need, in one query. */
export async function listTypesWithRules(spaceId: string): Promise<TypeWithRules[]> {
  return prisma.requirementType.findMany({
    where: { spaceId },
    orderBy: { keyPattern: 'asc' },
    include: {
      rules: { orderBy: { ordinal: 'asc' } },
      templateColumns: { orderBy: { ordinal: 'asc' } },
    },
  });
}

export async function findTypeWithRules(spaceId: string, typeId: string): Promise<TypeWithRules | null> {
  return prisma.requirementType.findFirst({
    where: { id: typeId, spaceId },
    include: {
      rules: { orderBy: { ordinal: 'asc' } },
      templateColumns: { orderBy: { ordinal: 'asc' } },
    },
  });
}

/** The domain's view of a stored type: its id and its rules, narrowed (`parseRules`). */
export function rulesOf(type: TypeWithRules): Rule[] {
  return parseRules(type.rules);
}

export function templateColumnsOf(type: TypeWithRules): TemplateColumn[] {
  return parseTemplateColumns(type.templateColumns);
}

export type TypeInput = {
  name: string | null;
  keyPattern: string;
  colour: string;
  locked: boolean;
  preventReusingDeletedKeys: boolean;
  rules: readonly Rule[];
  templateColumns: readonly TemplateColumn[];
};

function ruleRows(typeId: string, rules: readonly Rule[]): Prisma.RequirementTypeRuleCreateManyInput[] {
  return rules.map((rule, ordinal) => ({
    typeId,
    ordinal,
    kind: rule.kind,
    name: 'name' in rule ? rule.name : null,
    relationship: rule.kind === 'REQUIRED_DEPENDENCY' ? rule.relationship : null,
    direction: rule.kind === 'REQUIRED_DEPENDENCY' ? rule.direction : null,
    pattern: rule.kind === 'PROPERTY_MATCHES' ? rule.pattern : null,
    values: rule.kind === 'PROPERTY_IN' ? rule.values : [],
  }));
}

function templateRows(typeId: string, columns: readonly TemplateColumn[]): Prisma.TemplateColumnCreateManyInput[] {
  return columns.map((column, ordinal) => ({
    typeId,
    name: column.name,
    required: column.required,
    ordinal: column.ordinal ?? ordinal,
  }));
}

export async function createType(spaceId: string, input: TypeInput): Promise<TypeWithRules> {
  return prisma.$transaction(async (tx) => {
    const type = await tx.requirementType.create({
      data: {
        spaceId,
        name: input.name,
        keyPattern: input.keyPattern,
        colour: input.colour,
        locked: input.locked,
        preventReusingDeletedKeys: input.preventReusingDeletedKeys,
      },
    });
    await tx.requirementTypeRule.createMany({ data: ruleRows(type.id, input.rules) });
    await tx.templateColumn.createMany({ data: templateRows(type.id, input.templateColumns) });
    return tx.requirementType.findFirstOrThrow({
      where: { id: type.id },
      include: { rules: { orderBy: { ordinal: 'asc' } }, templateColumns: { orderBy: { ordinal: 'asc' } } },
    });
  });
}

/**
 * Rules and template columns are rewritten as a **set**: editing a type is editing the
 * whole list, so a rule the author removed is gone rather than orphaned.
 */
export async function updateType(spaceId: string, typeId: string, input: TypeInput): Promise<TypeWithRules> {
  return prisma.$transaction(async (tx) => {
    await tx.requirementType.update({
      where: { id: typeId },
      data: {
        name: input.name,
        keyPattern: input.keyPattern,
        colour: input.colour,
        locked: input.locked,
        preventReusingDeletedKeys: input.preventReusingDeletedKeys,
      },
    });
    await tx.requirementTypeRule.deleteMany({ where: { typeId } });
    await tx.templateColumn.deleteMany({ where: { typeId } });
    await tx.requirementTypeRule.createMany({ data: ruleRows(typeId, input.rules) });
    await tx.templateColumn.createMany({ data: templateRows(typeId, input.templateColumns) });

    return tx.requirementType.findFirstOrThrow({
      where: { id: typeId, spaceId },
      include: { rules: { orderBy: { ordinal: 'asc' } }, templateColumns: { orderBy: { ordinal: 'asc' } } },
    });
  });
}

/**
 * Deleting a type releases its requirements rather than deleting them: `Requirement.typeId`
 * is nullable, and a requirement is a projection of a document, not of a type.
 */
export async function deleteType(spaceId: string, typeId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.requirement.updateMany({ where: { spaceId, typeId, baselineId: null }, data: { typeId: null } });
    await tx.requirementType.deleteMany({ where: { id: typeId, spaceId } });
  });
}

/** One page of a type's live requirements, for the revalidation job. */
/** X3-exempt: the revalidation job writes validation rows for every member; it shows none. */
export async function requirementsOfType(
  typeId: string,
  offset: number,
  limit: number,
): Promise<Array<{ id: string; key: string; anchorPath: string }>> {
  return prisma.requirement.findMany({
    where: { typeId, baselineId: null, status: { not: 'DELETED' } },
    orderBy: { upperKey: 'asc' },
    skip: offset,
    take: limit,
    select: { id: true, key: true, anchorPath: true },
  });
}

export async function countRequirementsOfType(typeId: string, reader: ReaderScope): Promise<number> {
  if (reader === SYSTEM) {
    return prisma.requirement.count({ where: { typeId, baselineId: null, status: { not: 'DELETED' } } });
  }
  // Rule X2 — the types screen counts only what this reader may see.
  const { text, params } = render(sql`
    SELECT count(*)::int AS n FROM "Requirement" r
     WHERE r."typeId" = ${param(typeId)} AND r."baselineId" IS NULL AND r.status <> 'DELETED'
       AND (${substituteAlias(requirementVisibility(reader), 'r')})
  `);
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(text, ...params);
  return rows[0]?.n ?? 0;
}
