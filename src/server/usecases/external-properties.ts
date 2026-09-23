import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/domain/errors';
import {
  coerceValue,
  isDataType,
  normaliseName,
  type ExternalDefinition,
} from '@/domain/properties/external';
import { parseAndAnalyse } from '@/domain/ryql';
import { requireInstanceAdmin, requireSpace } from '@/server/authz';
import { recordAuditEvent } from '@/server/repositories/audit';
import {
  countValues,
  countValuesByDefinition,
  createDefinition,
  deleteDefinition,
  findDefinition,
  findDefinitionByName,
  listDefinitions,
  loadExternalTypes,
  setValueForRequirements,
  updateDefinition,
} from '@/server/repositories/external-properties';
import { groupIdsOf, runSearchIds, visibilityPredicate, visibleRequirementIds } from '@/server/repositories/search';

/**
 * External property definitions and values.
 * spec: 01-domain-model.md; 04 §2.2; 07 §2.1
 *
 * `RD-036` — definitions are instance-global, so only an instance administrator may
 * change them. A *value* is space work: `EDIT` for one, `EDIT` and `EXPORT` for a bulk
 * set across a whole result set (`RD-039`).
 */

export type DefinitionInput = {
  name: unknown;
  dataType: unknown;
  enumValues: unknown;
  description: unknown;
};

export type DefinitionView = ExternalDefinition & { valueCount: number };

export async function listDefinitionsUseCase(): Promise<ExternalDefinition[]> {
  await requireInstanceAdmin();
  return listDefinitions();
}

export async function listDefinitionsWithUsage(): Promise<DefinitionView[]> {
  await requireInstanceAdmin();
  const [definitions, counts] = await Promise.all([listDefinitions(), countValuesByDefinition()]);
  return definitions.map((definition) => ({ ...definition, valueCount: counts.get(definition.id) ?? 0 }));
}

function cleanDefinition(input: DefinitionInput): {
  name: string;
  dataType: ExternalDefinition['dataType'];
  enumValues: string[];
  description: string | null;
} {
  const named = normaliseName(input.name);
  if (!named) throw new ValidationError('A property needs a name of 1–64 characters.');
  if (!isDataType(input.dataType)) throw new ValidationError('Choose a data type for the property.');

  const enumValues =
    typeof input.enumValues === 'string'
      ? input.enumValues
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
      : Array.isArray(input.enumValues)
        ? input.enumValues.filter((value): value is string => typeof value === 'string')
        : [];

  if (input.dataType === 'ENUM' && enumValues.length === 0) {
    throw new ValidationError('A fixed-list property needs at least one value.');
  }
  if (new Set(enumValues).size !== enumValues.length) {
    throw new ValidationError('The list of values contains a duplicate.');
  }

  const description = typeof input.description === 'string' ? input.description.trim() : '';

  return {
    name: named.name,
    dataType: input.dataType,
    enumValues: input.dataType === 'ENUM' ? enumValues : [],
    description: description.length > 0 ? description : null,
  };
}

export async function createDefinitionUseCase(input: DefinitionInput): Promise<ExternalDefinition> {
  const user = await requireInstanceAdmin();
  const cleaned = cleanDefinition(input);

  const existing = await findDefinitionByName(cleaned.name);
  if (existing) throw new ConflictError(`A property called "${existing.name}" already exists.`);

  const created = await createDefinition(cleaned);
  await auditDefinition(user.id, created.id, 'create', cleaned);
  return created;
}

export async function updateDefinitionUseCase(id: string, input: DefinitionInput): Promise<ExternalDefinition> {
  const user = await requireInstanceAdmin();
  const cleaned = cleanDefinition(input);

  const current = await findDefinition(id);
  if (!current) throw new NotFoundError('That property definition no longer exists.');

  const clash = await findDefinitionByName(cleaned.name);
  if (clash && clash.id !== id) throw new ConflictError(`A property called "${clash.name}" already exists.`);

  // Changing the type would leave values that the new type cannot hold, and `ext@` would
  // then compare in a type its rows do not satisfy (RD-037). Clearing the values first is
  // the explicit act; silently reinterpreting them is not.
  if (cleaned.dataType !== current.dataType) {
    const used = await countValues(id);
    if (used > 0) {
      throw new ConflictError(
        `"${current.name}" holds ${used} value${used === 1 ? '' : 's'}, so its type cannot change. Clear them first.`,
      );
    }
  }

  // Narrowing a fixed list would strand values that are no longer members.
  if (cleaned.dataType === 'ENUM' && current.dataType === 'ENUM') {
    const dropped = current.enumValues.filter((value) => !cleaned.enumValues.includes(value));
    if (dropped.length > 0) {
      const inUse = await countValues(id);
      if (inUse > 0) {
        throw new ConflictError(
          `Removing ${dropped.join(', ')} would strand values already set. Clear them first.`,
        );
      }
    }
  }

  const updated = await updateDefinition(id, cleaned);
  await auditDefinition(user.id, id, 'update', { from: current, to: cleaned });
  return updated;
}

export async function deleteDefinitionUseCase(id: string): Promise<void> {
  const user = await requireInstanceAdmin();
  const current = await findDefinition(id);
  await deleteDefinition(id);
  await auditDefinition(user.id, id, 'delete', { name: current?.name ?? id });
}

/** RD-062 — instance-wide, so the row carries no space. */
async function auditDefinition(actorId: string, id: string, operation: string, parameters: unknown): Promise<void> {
  await recordAuditEvent({
    actorId,
    spaceId: null,
    objectType: 'ExternalPropertyDefinition',
    objectId: id,
    operation,
    parameters: JSON.parse(JSON.stringify(parameters)),
  });
}

/** Every definition, for the screens that only display and edit values. */
export async function definitionsForSpace(spaceKey: string): Promise<ExternalDefinition[]> {
  await requireSpace(spaceKey);
  return listDefinitions();
}

export type SetValueOutcome = { written: number; value: string | null };

async function resolveDefinition(id: unknown): Promise<ExternalDefinition> {
  const definition = typeof id === 'string' ? await findDefinition(id) : null;
  if (!definition) throw new NotFoundError('That property is not defined.');
  return definition;
}

/**
 * Sets one requirement's value. `EDIT` on the space (spec 07 §2.1), and the requirement
 * must be one the caller can actually see — a write filters through the same visibility
 * predicate a read does (rule X3).
 */
export async function setValueUseCase(input: {
  spaceKey: string;
  requirementId: unknown;
  definitionId: unknown;
  value: unknown;
}): Promise<SetValueOutcome> {
  const { space, user } = await requireSpace(input.spaceKey, 'EDIT');
  const definition = await resolveDefinition(input.definitionId);

  const coerced = coerceValue(definition, input.value);
  if (!coerced.ok) throw new ValidationError(coerced.message);

  const requirementId = typeof input.requirementId === 'string' ? input.requirementId : '';
  const visible = await visibleRequirementIds([requirementId], user.id, await groupIdsOf(user.id));
  if (visible.length === 0) throw new NotFoundError('That requirement no longer exists.');

  const written = await setValueForRequirements({
    requirementIds: visible,
    definition,
    value: coerced.value,
    actorId: user.id,
    historyEnabled: space.historyEnabled,
  });
  return { written, value: coerced.value };
}

export type BulkSetOutcome = { written: number; population: number; value: string | null };

/**
 * "Set value in bulk" across the whole result set, not just the visible page
 * (spec 04 §2.2). `RD-039` — a write (`EDIT`) over a whole result set (`EXPORT`).
 */
export async function setValueInBulkUseCase(input: {
  spaceKey: string;
  query: unknown;
  definitionId: unknown;
  value: unknown;
  crossSpace?: boolean;
}): Promise<BulkSetOutcome> {
  const { space, user, can } = await requireSpace(input.spaceKey, 'EDIT');
  if (!can('EXPORT')) {
    throw new ForbiddenError('Setting a value in bulk needs the EXPORT permission as well as EDIT.');
  }

  const definition = await resolveDefinition(input.definitionId);
  const coerced = coerceValue(definition, input.value);
  if (!coerced.ok) throw new ValidationError(coerced.message);

  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (query.length === 0) throw new ValidationError('A bulk change needs a query to say which requirements.');

  const externalTypes = await loadExternalTypes();
  const analysed = parseAndAnalyse(query, {
    spaceKey: space.key,
    isolated: space.isolated,
    crossSpace: input.crossSpace ?? false,
    externalTypes,
  });
  if (!analysed.ok) {
    throw new ValidationError(`That query does not parse: ${analysed.errors[0]?.message ?? 'unknown error'}`);
  }

  // The population is resolved under the visibility predicate, so a bulk set can only
  // reach rows the caller could have listed for themselves.
  const ids = await runSearchIds(analysed.query.expr, {
    visibility: visibilityPredicate(user.id, await groupIdsOf(user.id)),
    externalTypes,
  });

  const written = await setValueForRequirements({
    requirementIds: ids,
    definition,
    value: coerced.value,
    actorId: user.id,
    historyEnabled: space.historyEnabled,
  });
  return { written, population: ids.length, value: coerced.value };
}
