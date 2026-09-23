import type { Baseline, Prisma } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '@/domain/errors';
import {
  baselineReportDocument,
  baselineReportTitle,
  checkFreezeable,
  closeOverParents,
  partitionDependencies,
  type Edge,
} from '@/domain/baselines';
import { parseAndAnalyse, type RqlDiagnostic } from '@/domain/ryql';
import { requireSpace } from '@/server/authz';
import { registerJobHandlers } from '@/server/jobs/register';
import { jobsRunInline, runJobNow } from '@/server/jobs/runner';
import {
  attachReportDocument,
  clearBaselineRows,
  countMembers,
  createDraft,
  deleteBaseline,
  findBaselineById,
  findBaselineByNumber,
  frozenMemberKeys,
  listBaselines,
  listDangling,
  listMembers,
  upperKeysOf,
  listRevisions,
  loadEdges,
  recordAudit,
  recordRevision,
  renameBaseline,
  requireFrozen,
  type BaselineWithCounts,
} from '@/server/repositories/baselines';
import { levelById } from '@/server/repositories/classification';
import { SYSTEM } from '@/server/repositories/visibility';
import { createDocument } from '@/server/repositories/documents';
import { loadExternalTypes } from '@/server/repositories/external-properties';
import { enqueueJob, findJob } from '@/server/repositories/jobs';
import { groupIdsOf, runSearchIds, visibilityPredicate } from '@/server/repositories/search';
import { findDocument } from '@/server/repositories/documents';

/**
 * Baselines.
 * spec: 05-baselines-and-diff.md §2–4; 07 §2.1 lists baselines under `ADMIN`.
 *
 * A DRAFT owns no rows (invariant B1): its members are computed from its query every
 * time they are asked for, which is what makes a draft useful — you assemble the scope
 * while the documents still move, and freeze when it is agreed.
 */

export const FREEZE_BATCH_SIZE = 500;

export type MemberPreview = {
  /** Member keys in key order: the query's answer, plus the parent closure. */
  keys: string[];
  /** How many the parent closure added (spec 05 §3.2 step 2). */
  addedByClosure: number;
  /** True when the closure stopped at the depth cap rather than at a fixed point. */
  truncated: boolean;
  danglingCount: number;
};

export type PreviewSuccess = { ok: true; preview: MemberPreview; warnings: RqlDiagnostic[] };
export type PreviewFailure = { ok: false; errors: RqlDiagnostic[] };

/**
 * Resolves a query to a member set, exactly as a freeze would.
 * The draft preview and the freeze share this, so what you see before pressing Freeze is
 * what gets frozen.
 */
export async function resolveMembers(input: {
  spaceId: string;
  spaceKey: string;
  isolated: boolean;
  userId: string;
  query: string;
  includeParentDependencies: boolean;
}): Promise<PreviewSuccess | PreviewFailure> {
  const query = input.query.trim();
  if (query.length === 0) {
    return {
      ok: false,
      errors: [
        {
          code: 'SYNTAX_ERROR',
          severity: 'error',
          message: 'A baseline needs a query to say what it contains.',
          offset: 0,
          length: 0,
          hint: "For example: key ~ 'FN-%'",
        },
      ],
    };
  }

  const externalTypes = await loadExternalTypes();
  const analysed = parseAndAnalyse(query, {
    spaceKey: input.spaceKey,
    isolated: input.isolated,
    defaultBaseline: null,
    externalTypes,
  });
  if (!analysed.ok) return { ok: false, errors: analysed.errors };

  // Resolved under the visibility predicate: a baseline can only hold what the person
  // freezing it could have listed for themselves (rule X3).
  const ids = await runSearchIds(analysed.query.expr, {
    visibility: visibilityPredicate(input.userId, await groupIdsOf(input.userId)),
    externalTypes,
  });

  const seeds = await upperKeysOf(ids);

  let keys = seeds;
  let addedByClosure = 0;
  let truncated = false;

  if (input.includeParentDependencies && seeds.length > 0) {
    // The closure walks the live dependency graph, so it needs the edges of everything
    // it has reached so far — repeated until nothing new appears (spec 05 §3.2 step 2).
    const closure = await closeWithEdges(input.spaceId, seeds);
    keys = closure.keys;
    addedByClosure = closure.added;
    truncated = closure.truncated;
  }

  const edges = await loadEdges(input.spaceId, keys);
  const { dangling } = partitionDependencies(edges, keys);

  return {
    ok: true,
    preview: { keys, addedByClosure, truncated, danglingCount: dangling.length },
    warnings: analysed.warnings,
  };
}

/**
 * The closure needs the edges of the keys it has reached, which it does not know until it
 * has reached them — so it loads and closes in lockstep until the key set stops growing.
 */
async function closeWithEdges(spaceId: string, seeds: readonly string[]) {
  let keys = [...seeds];
  let edges: Edge[] = [];

  for (let round = 0; round < 10; round += 1) {
    edges = await loadEdges(spaceId, keys);
    const closure = closeOverParents(seeds, edges);
    if (closure.keys.length === keys.length) return closure;
    keys = closure.keys;
  }

  return closeOverParents(seeds, edges);
}

export async function listBaselinesUseCase(spaceKey: string): Promise<BaselineWithCounts[]> {
  const { space, viewer } = await requireSpace(spaceKey);
  return listBaselines(viewer, space.id);
}

export async function previewUseCase(input: {
  spaceKey: string;
  query: string;
  includeParentDependencies: boolean;
}): Promise<PreviewSuccess | PreviewFailure> {
  const { space, user } = await requireSpace(input.spaceKey);
  return resolveMembers({
    spaceId: space.id,
    spaceKey: space.key,
    isolated: space.isolated,
    userId: user.id,
    query: input.query,
    includeParentDependencies: input.includeParentDependencies,
  });
}

export type CreateBaselineInput = {
  spaceKey: string;
  name: unknown;
  query: unknown;
  includeParentDependencies?: boolean;
  includedExternal?: boolean;
  withReportDocument?: boolean;
};

const NAME_MAX = 200;

function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name.length === 0) throw new ValidationError('A baseline needs a name.');
  if (name.length > NAME_MAX) throw new ValidationError(`A baseline name may be at most ${NAME_MAX} characters.`);
  return name;
}

/** spec 05 §2 — creating a DRAFT. It owns no requirement rows (invariant B1). */
export async function createBaselineUseCase(input: CreateBaselineInput): Promise<Baseline> {
  const { space, user } = await requireSpace(input.spaceKey, 'ADMIN');
  const name = cleanName(input.name);
  const query = typeof input.query === 'string' ? input.query.trim() : '';

  // Never store a query that does not parse — the draft would be unfreezable.
  const analysed = parseAndAnalyse(query, {
    spaceKey: space.key,
    isolated: space.isolated,
    externalTypes: await loadExternalTypes(),
  });
  if (!analysed.ok) {
    throw new ValidationError(`That query does not parse: ${analysed.errors[0]?.message ?? 'unknown error'}`);
  }

  const baseline = await createDraft({
    spaceId: space.id,
    name,
    sourceQuery: query,
    includedDependencies: input.includeParentDependencies === true,
    includedExternal: input.includedExternal === true,
    createdById: user.id,
  });

  await recordAudit({
    actorId: user.id,
    spaceId: space.id,
    objectId: baseline.id,
    operation: 'create',
    parameters: { number: baseline.number, name, query },
  });

  // RD-045 — a report document with a live report over this baseline's members. It is
  // also the path that exercises RD-031's `$currentBaseline` resolution.
  if (input.withReportDocument) {
    const document = await createDocument({
      spaceId: space.id,
      title: baselineReportTitle({ number: baseline.number, name }),
      parentId: null,
      authorId: user.id,
      content: baselineReportDocument({ number: baseline.number, name }),
    });
    await attachReportDocument(baseline.id, document.id);
  }

  return baseline;
}

export async function renameBaselineUseCase(spaceKey: string, id: string, name: unknown): Promise<Baseline> {
  const { space, user } = await requireSpace(spaceKey, 'ADMIN');
  const renamed = await renameBaseline(space.id, id, cleanName(name));
  await recordAudit({
    actorId: user.id,
    spaceId: space.id,
    objectId: id,
    operation: 'rename',
    parameters: { number: renamed.number, name: renamed.name },
  });
  return renamed;
}

export async function deleteBaselineUseCase(spaceKey: string, id: string): Promise<void> {
  const { space, user } = await requireSpace(spaceKey, 'ADMIN');
  const baseline = await findBaselineById(space.id, id);
  if (!baseline) throw new NotFoundError('That baseline no longer exists.');

  // The audit row outlives the baseline, which is what keeps its number from being
  // reissued (invariant B2) and what an auditor reads to see it ever existed.
  await recordAudit({
    actorId: user.id,
    spaceId: space.id,
    objectId: id,
    operation: 'delete',
    parameters: { number: baseline.number, name: baseline.name, memberCount: await countMembers(id, SYSTEM) },
  });
  await deleteBaseline(space.id, id);
}

/** spec 05 §3 — the freeze, as a job with progress and cancel. */
export async function freezeUseCase(input: { spaceKey: string; id: string }) {
  const { space, user } = await requireSpace(input.spaceKey, 'ADMIN');
  const baseline = await findBaselineById(space.id, input.id);
  if (!baseline) throw new NotFoundError('That baseline no longer exists.');
  if (baseline.state === 'FROZEN') {
    throw new ConflictError(`Baseline ${baseline.number} is already frozen. Refreeze it to change its members.`);
  }

  const members = await resolveMembers({
    spaceId: space.id,
    spaceKey: space.key,
    isolated: space.isolated,
    userId: user.id,
    query: baseline.sourceQuery,
    includeParentDependencies: baseline.includedDependencies,
  });
  if (!members.ok) {
    throw new ValidationError(`That baseline's query no longer runs: ${members.errors[0]?.message ?? ''}`);
  }

  const checked = checkFreezeable(members.preview.keys);
  if (!checked.ok) throw new ValidationError(checked.message);

  return enqueueFreeze({
    spaceId: space.id,
    spaceKey: space.key,
    baselineId: baseline.id,
    actorId: user.id,
    memberKeys: members.preview.keys,
    includedExternal: baseline.includedExternal,
    operation: 'freeze',
    parameters: { number: baseline.number, members: checked.count, dangling: members.preview.danglingCount },
  });
}

/**
 * spec 05 §2 — the instant baseline: creation and freeze in one action, scoped to a
 * single document, with no report document. RY's fourth creation path (research §5.1).
 */
export async function instantBaselineUseCase(input: { spaceKey: string; documentId: string; name: unknown }) {
  const { space, viewer } = await requireSpace(input.spaceKey, 'ADMIN');
  // RD-064 — a document the administrator cannot see cannot be baselined by them either.
  const document = await findDocument(viewer, space.id, input.documentId);
  if (!document) throw new NotFoundError('That document no longer exists.');

  const name = typeof input.name === 'string' && input.name.trim().length > 0 ? input.name.trim() : document.title;
  const baseline = await createBaselineUseCase({
    spaceKey: input.spaceKey,
    name,
    query: `document = '${document.id}'`,
    includeParentDependencies: false,
    includedExternal: false,
    withReportDocument: false,
  });

  return freezeUseCase({ spaceKey: input.spaceKey, id: baseline.id });
}

/**
 * spec 05 §3.4 — refreeze. Delete and re-insert in one run, with a `BaselineRevision`
 * recording who, when, why and the before/after counts. The revision history is not
 * erasable, and a refrozen baseline is visibly marked as revised.
 */
export async function refreezeUseCase(input: { spaceKey: string; id: string; reason: unknown }) {
  const { space, user } = await requireSpace(input.spaceKey, 'ADMIN');
  const baseline = await requireFrozen(space.id, input.id);

  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length === 0) {
    throw new ValidationError('A refreeze needs a reason. It is the part an auditor reads.');
  }

  const before = await frozenMemberKeys(baseline.id);
  const members = await resolveMembers({
    spaceId: space.id,
    spaceKey: space.key,
    isolated: space.isolated,
    userId: user.id,
    query: baseline.sourceQuery,
    includeParentDependencies: baseline.includedDependencies,
  });
  if (!members.ok) {
    throw new ValidationError(`That baseline's query no longer runs: ${members.errors[0]?.message ?? ''}`);
  }

  const checked = checkFreezeable(members.preview.keys);
  if (!checked.ok) throw new ValidationError(checked.message);

  const after = members.preview.keys;
  const added = after.filter((key) => !before.includes(key));
  const removed = before.filter((key) => !after.includes(key));

  await recordRevision({
    baselineId: baseline.id,
    actorId: user.id,
    reason,
    countBefore: before.length,
    countAfter: after.length,
    detail: { added: added.slice(0, 200), removed: removed.slice(0, 200) },
  });

  return enqueueFreeze({
    spaceId: space.id,
    spaceKey: space.key,
    baselineId: baseline.id,
    actorId: user.id,
    memberKeys: after,
    includedExternal: baseline.includedExternal,
    operation: 'refreeze',
    parameters: { number: baseline.number, reason, added: added.length, removed: removed.length },
  });
}

async function enqueueFreeze(input: {
  spaceId: string;
  spaceKey: string;
  baselineId: string;
  actorId: string;
  memberKeys: string[];
  includedExternal: boolean;
  operation: string;
  parameters: Prisma.InputJsonValue;
}) {
  registerJobHandlers();

  await recordAudit({
    actorId: input.actorId,
    spaceId: input.spaceId,
    objectId: input.baselineId,
    operation: input.operation,
    parameters: input.parameters,
  });

  const job = await enqueueJob({
    spaceId: input.spaceId,
    kind: 'freeze-baseline',
    actorId: input.actorId,
    payload: {
      spaceKey: input.spaceKey,
      baselineId: input.baselineId,
      memberKeys: input.memberKeys,
      includedExternal: input.includedExternal,
      batchSize: FREEZE_BATCH_SIZE,
      actorId: input.actorId,
    },
  });

  if (jobsRunInline()) await runJobNow(job.id);
  else void runJobNow(job.id);

  return (await findJob(job.id)) ?? job;
}

export type BaselineDetail = {
  baseline: Baseline;
  memberCount: number;
  /** The members this reader may see, capped for the page (rules X2, X4). */
  members: Awaited<ReturnType<typeof listMembers>>;
  /** spec 07 §2.3 — the label captured at freeze (RD-060). */
  classification: string | null;
  dangling: Awaited<ReturnType<typeof listDangling>>;
  revisions: Awaited<ReturnType<typeof listRevisions>>;
  reportDocumentId: string | null;
};

export async function baselineDetailUseCase(spaceKey: string, number: number): Promise<BaselineDetail> {
  const { space, viewer } = await requireSpace(spaceKey);
  const baseline = await findBaselineByNumber(space.id, number);
  if (!baseline) throw new NotFoundError(`Baseline ${number} does not exist in ${spaceKey}.`);

  const [memberCount, members, dangling, revisions, label] = await Promise.all([
    countMembers(baseline.id, viewer),
    listMembers(viewer, baseline.id),
    listDangling(viewer, baseline.id),
    listRevisions(baseline.id),
    levelById(baseline.classificationId),
  ]);

  return {
    baseline,
    memberCount,
    members,
    dangling,
    revisions,
    reportDocumentId: baseline.reportDocumentId,
    classification: label?.name ?? null,
  };
}

/** Abandoning a draft's partial rows, e.g. after a failed freeze. */
export async function discardRowsUseCase(spaceKey: string, id: string): Promise<number> {
  const { space, user } = await requireSpace(spaceKey, 'ADMIN');
  const baseline = await findBaselineById(space.id, id);
  if (!baseline) throw new NotFoundError('That baseline no longer exists.');
  if (baseline.state === 'FROZEN') throw new ConflictError('A frozen baseline keeps its rows. Refreeze it instead.');
  const removed = await clearBaselineRows(id);
  await recordAudit({
    actorId: user.id,
    spaceId: space.id,
    objectId: id,
    operation: 'discard-rows',
    parameters: { number: baseline.number, removed },
  });
  return removed;
}
