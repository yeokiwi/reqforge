import { ConflictError, NotFoundError, ValidationError } from '@/domain/errors';
import { parsePattern } from '@/domain/keys/pattern';
import {
  compilePattern,
  MAX_RULES_PER_TYPE,
  parseRule,
  parseTemplateColumns,
  type Rule,
  type TemplateColumn,
} from '@/domain/validation';
import { requireSpace } from '@/server/authz';
import { recordAuditEvent } from '@/server/repositories/audit';
import {
  countRequirementsOfType,
  createType,
  deleteType,
  findTypeWithRules,
  listTypesWithRules,
  rulesOf,
  templateColumnsOf,
  updateType,
  type TypeInput,
  type TypeWithRules,
} from '@/server/repositories/requirement-types';
import { countByStatusForSpace, type StatusCounts } from '@/server/repositories/validations';
import { enqueueJob, findJob } from '@/server/repositories/jobs';
import { registerJobHandlers } from '@/server/jobs/register';
import { jobsRunInline, runJobNow } from '@/server/jobs/runner';

/**
 * Requirement types and their rules.
 * spec: 06-requirement-types.md §5 — read with view, run one type's validation with edit,
 * create/update/delete and lock keys with space admin. Exactly RY's table (research §2.4).
 */

export type TypeView = {
  id: string;
  name: string | null;
  keyPattern: string;
  colour: string;
  locked: boolean;
  preventReusingDeletedKeys: boolean;
  nextSequence: number;
  rules: Rule[];
  templateColumns: TemplateColumn[];
  counts: StatusCounts;
  requirementCount: number;
};

function toView(type: TypeWithRules, counts: StatusCounts, requirementCount: number): TypeView {
  return {
    id: type.id,
    name: type.name,
    keyPattern: type.keyPattern,
    colour: type.colour,
    locked: type.locked,
    preventReusingDeletedKeys: type.preventReusingDeletedKeys,
    nextSequence: type.nextSequence,
    rules: rulesOf(type),
    templateColumns: templateColumnsOf(type),
    counts,
    requirementCount,
  };
}

export async function listTypesUseCase(spaceKey: string): Promise<TypeView[]> {
  const { space, viewer } = await requireSpace(spaceKey);
  const [types, counts] = await Promise.all([listTypesWithRules(space.id), countByStatusForSpace(viewer, space.id)]);

  return Promise.all(
    types.map(async (type) =>
      toView(
        type,
        counts.get(type.id) ?? { TRUE: 0, FALSE: 0, WARNING: 0 },
        await countRequirementsOfType(type.id, viewer),
      ),
    ),
  );
}

/** The types a document's editor needs: their patterns and their template columns. */
export async function typesForEditor(spaceKey: string) {
  const { space } = await requireSpace(spaceKey);
  const types = await listTypesWithRules(space.id);
  return types.map((type) => ({
    id: type.id,
    name: type.name,
    keyPattern: type.keyPattern,
    colour: type.colour,
    templateColumns: templateColumnsOf(type),
  }));
}

const COLOUR = /^#[0-9a-fA-F]{6}$/;

function cleanType(form: {
  name: unknown;
  keyPattern: unknown;
  colour: unknown;
  locked: unknown;
  preventReusingDeletedKeys: unknown;
  rules: unknown;
  templateColumns: unknown;
}): TypeInput {
  const keyPattern = typeof form.keyPattern === 'string' ? form.keyPattern.trim() : '';
  const parsed = parsePattern(keyPattern);
  if (!parsed.ok) throw new ValidationError(`That key pattern is not usable: ${parsed.message}`);

  const name = typeof form.name === 'string' && form.name.trim().length > 0 ? form.name.trim() : null;
  const colour = typeof form.colour === 'string' && COLOUR.test(form.colour.trim()) ? form.colour.trim() : '#4a5568';

  const rules = Array.isArray(form.rules)
    ? form.rules.map((row, index) => {
        const rule = parseRule(row);
        if (!rule) throw new ValidationError(`Rule ${index + 1} is incomplete. Fill in every field it needs.`);
        // A pattern that does not compile would be a rule that silently never matches,
        // so it is refused here where the author can see the message (spec 06 §1).
        if (rule.kind === 'PROPERTY_MATCHES' && !compilePattern(rule.pattern)) {
          throw new ValidationError(`Rule ${index + 1}: "${rule.pattern}" is not a valid regular expression.`);
        }
        return rule;
      })
    : [];

  // spec 06 §2.3 — the limit is named in the message (spec 07 §4).
  if (rules.length > MAX_RULES_PER_TYPE) {
    throw new ValidationError(`A type may have at most ${MAX_RULES_PER_TYPE} rules; this one has ${rules.length}.`);
  }

  return {
    name,
    keyPattern,
    colour,
    locked: form.locked === true || form.locked === 'on',
    preventReusingDeletedKeys: form.preventReusingDeletedKeys === true || form.preventReusingDeletedKeys === 'on',
    rules,
    templateColumns: parseTemplateColumns(form.templateColumns),
  };
}

export async function createTypeUseCase(spaceKey: string, form: Parameters<typeof cleanType>[0]) {
  const { space, user } = await requireSpace(spaceKey, 'ADMIN');
  const input = cleanType(form);

  const existing = await listTypesWithRules(space.id);
  if (existing.some((type) => type.keyPattern === input.keyPattern)) {
    throw new ConflictError(`This space already has a type for the pattern ${input.keyPattern}.`);
  }
  const created = await createType(space.id, input);
  // spec 07 §6 / RD-062 — a type's rules decide what counts as valid; changing them is audited.
  await recordAuditEvent({
    actorId: user.id,
    spaceId: space.id,
    objectType: 'RequirementType',
    objectId: created.id,
    operation: 'create',
    parameters: JSON.parse(JSON.stringify(input)),
  });
  return created;
}

export async function updateTypeUseCase(spaceKey: string, typeId: string, form: Parameters<typeof cleanType>[0]) {
  const { space, user } = await requireSpace(spaceKey, 'ADMIN');
  const input = cleanType(form);

  const current = await findTypeWithRules(space.id, typeId);
  if (!current) throw new NotFoundError('That requirement type no longer exists.');

  const existing = await listTypesWithRules(space.id);
  if (existing.some((type) => type.id !== typeId && type.keyPattern === input.keyPattern)) {
    throw new ConflictError(`This space already has a type for the pattern ${input.keyPattern}.`);
  }

  const updated = await updateType(space.id, typeId, input);
  await recordAuditEvent({
    actorId: user.id,
    spaceId: space.id,
    objectType: 'RequirementType',
    objectId: typeId,
    operation: 'update',
    parameters: JSON.parse(JSON.stringify({ from: { name: current.name, keyPattern: current.keyPattern }, to: input })),
  });
  // spec 06 §2.2 trigger 2 — the one RY cannot do (RD-016): editing a type revalidates
  // every requirement of that type, through a job with progress.
  const job = await enqueueRevalidation({ spaceKey, spaceId: space.id, typeId, actorId: user.id });
  return { type: updated, job };
}

export async function deleteTypeUseCase(spaceKey: string, typeId: string): Promise<void> {
  const { space, user } = await requireSpace(spaceKey, 'ADMIN');
  const current = await findTypeWithRules(space.id, typeId);
  if (!current) throw new NotFoundError('That requirement type no longer exists.');
  await deleteType(space.id, typeId);
  await recordAuditEvent({
    actorId: user.id,
    spaceId: space.id,
    objectType: 'RequirementType',
    objectId: typeId,
    operation: 'delete',
    parameters: { name: current.name, keyPattern: current.keyPattern },
  });
}

/** spec 06 §2.2 trigger 3 — "run validation" per type, on demand. Edit, not admin (§5). */
export async function runValidationUseCase(spaceKey: string, typeId: string) {
  const { space, user } = await requireSpace(spaceKey, 'EDIT');
  const type = await findTypeWithRules(space.id, typeId);
  if (!type) throw new NotFoundError('That requirement type no longer exists.');
  return enqueueRevalidation({ spaceKey, spaceId: space.id, typeId, actorId: user.id });
}

/** The revalidation job, queued the same way every other job in the app is. */
async function enqueueRevalidation(input: {
  spaceKey: string;
  spaceId: string;
  typeId: string;
  actorId: string;
}) {
  registerJobHandlers();

  const job = await enqueueJob({
    spaceId: input.spaceId,
    kind: 'revalidate-type',
    actorId: input.actorId,
    payload: { spaceKey: input.spaceKey, typeId: input.typeId, pageSize: 200, actorId: input.actorId },
  });

  if (jobsRunInline()) await runJobNow(job.id);
  else void runJobNow(job.id);

  return (await findJob(job.id)) ?? job;
}
