import { attr, isPMNode, walk, type PMNode } from '@/domain/doc';
import { LINK_NODE } from '@/domain/doc/references';
import { highest, type ClassificationLabel } from '@/domain/classification';
import { ConflictError, NotFoundError } from '@/domain/errors';
import { parseAndAnalyse } from '@/domain/ryql';
import { requireInstanceAdmin, requireSpace } from '@/server/authz';
import { recordAuditEvent } from '@/server/repositories/audit';
import {
  createLevel,
  deleteLevel,
  documentLabel,
  labelForRequirements,
  levelById,
  listLevels,
  renameLevel,
  reorderLevels,
  setDocumentLabel,
  setSpaceLabel,
} from '@/server/repositories/classification';
import { findSavedMatrix } from '@/server/repositories/matrices';
import { runSearchIds, visibilityPredicate } from '@/server/repositories/search';
import { findDocument } from '@/server/repositories/documents';
import type { Viewer } from '@/server/repositories/visibility';
import { loadExternalTypes } from '@/server/repositories/external-properties';

/**
 * Classification labels. spec: 07-permissions-and-limits.md §2.3; RD-060.
 * Levels are instance-global, so instance administrators own them, as they own external
 * property definitions (RD-036). Labelling a space is space ADMIN; labelling a document is
 * whoever may edit it.
 */

async function auditInstance(actorId: string, operation: string, parameters: Record<string, unknown>) {
  await recordAuditEvent({
    actorId,
    spaceId: null,
    objectType: 'ClassificationLevel',
    objectId: typeof parameters.id === 'string' ? parameters.id : '-',
    operation,
    parameters: JSON.parse(JSON.stringify(parameters)),
  });
}

export async function listLevelsUseCase(): Promise<ClassificationLabel[]> {
  return listLevels();
}

export async function createLevelUseCase(name: unknown): Promise<ClassificationLabel> {
  const user = await requireInstanceAdmin();
  const level = await createLevel(name);
  await auditInstance(user.id, 'create', { id: level.id, name: level.name, rank: level.rank });
  return level;
}

export async function renameLevelUseCase(id: string, name: unknown): Promise<ClassificationLabel> {
  const user = await requireInstanceAdmin();
  const before = await levelById(id);
  if (!before) throw new NotFoundError('That label no longer exists.');
  const level = await renameLevel(id, name);
  await auditInstance(user.id, 'rename', { id, from: before.name, to: level.name });
  return level;
}

export async function reorderLevelsUseCase(orderedIds: readonly string[]): Promise<void> {
  const user = await requireInstanceAdmin();
  await reorderLevels(orderedIds);
  await auditInstance(user.id, 'reorder', { order: [...orderedIds] });
}

export async function deleteLevelUseCase(id: string): Promise<void> {
  const user = await requireInstanceAdmin();
  const before = await levelById(id);
  if (!before) throw new NotFoundError('That label no longer exists.');
  await deleteLevel(id);
  await auditInstance(user.id, 'delete', { id, name: before.name });
}

async function checkedLevel(levelId: string | null): Promise<string | null> {
  if (levelId === null || levelId === '') return null;
  const level = await levelById(levelId);
  if (!level) throw new ConflictError('That label no longer exists.');
  return level.id;
}

export async function setSpaceLabelUseCase(spaceKey: string, levelId: string | null): Promise<void> {
  const { space, user } = await requireSpace(spaceKey, 'ADMIN');
  const next = await checkedLevel(levelId);
  await setSpaceLabel(space.id, next);
  await recordAuditEvent({
    actorId: user.id,
    spaceId: space.id,
    objectType: 'Space',
    objectId: space.id,
    operation: 'classify',
    parameters: { from: space.classificationId, to: next },
  });
}

/** Called by the document usecase once it has established the actor may edit it. */
export async function labelDocument(input: {
  spaceId: string;
  documentId: string;
  actorId: string;
  levelId: string | null;
}): Promise<void> {
  const next = await checkedLevel(input.levelId);
  await setDocumentLabel(input.documentId, next);
  await recordAuditEvent({
    actorId: input.actorId,
    spaceId: input.spaceId,
    objectType: 'Document',
    objectId: input.documentId,
    operation: 'classify',
    parameters: { to: next },
  });
}

const REPORT_NODE = 'report';
const MATRIX_NODE = 'savedMatrix';

/**
 * spec 07 §2.3 — "propagated upward: a document's effective label is the highest of its
 * own and any label on content it embeds". What a document embeds is its links, its
 * reports and its saved matrices, and what they show depends on who reads them, so the
 * label is computed for this reader over the rows they would actually see (RD-060).
 */
export async function effectiveDocumentLabel(input: {
  viewer: Viewer;
  space: { id: string; key: string; isolated: boolean };
  documentId: string;
  content: unknown;
}): Promise<ClassificationLabel | null> {
  const own = await documentLabel(input.documentId);
  if (!isPMNode(input.content)) return own;

  const linkKeys: string[] = [];
  const queries: string[] = [];
  const matrixIds: string[] = [];
  for (const { node } of walk(input.content as PMNode)) {
    if (node.type === LINK_NODE) {
      const spaceKey = attr(node, 'spaceKey');
      const key = attr(node, 'key');
      if (key && (!spaceKey || spaceKey === input.space.key)) linkKeys.push(key);
    } else if (node.type === REPORT_NODE) {
      const query = attr(node, 'query');
      if (query && query.trim().length > 0) queries.push(query);
    } else if (node.type === MATRIX_NODE) {
      const id = attr(node, 'id');
      if (id) matrixIds.push(id);
    }
  }

  for (const id of matrixIds) {
    const matrix = await findSavedMatrix(id);
    if (matrix && matrix.spaceId === input.space.id) queries.push(matrix.query);
  }

  const escaped = linkKeys.map((key) => `'${key.replace(/'/g, "\\'")}'`);
  if (escaped.length > 0) queries.push(`key IN (${escaped.join(', ')})`);
  if (queries.length === 0) return own;

  const externalTypes = await loadExternalTypes();
  const visibility = visibilityPredicate(input.viewer.userId, input.viewer.groupIds);
  const ids: string[] = [];
  for (const query of queries) {
    const analysed = parseAndAnalyse(query, {
      spaceKey: input.space.key,
      isolated: input.space.isolated,
      defaultBaseline: null,
      externalTypes,
    });
    // A report that no longer parses renders nothing, so it contributes nothing.
    if (!analysed.ok) continue;
    ids.push(...(await runSearchIds(analysed.query.expr, { visibility, externalTypes })));
  }

  return highest([own, await labelForRequirements(ids)]);
}

/** The document header's label, for a document the reader has already been allowed to open. */
export async function documentLabelUseCase(spaceKey: string, documentId: string): Promise<ClassificationLabel | null> {
  const { space, viewer } = await requireSpace(spaceKey);
  const document = await findDocument(viewer, space.id, documentId);
  if (!document) throw new NotFoundError('That document no longer exists.');
  return effectiveDocumentLabel({
    viewer,
    space: { id: space.id, key: space.key, isolated: space.isolated },
    documentId,
    content: document.currentVersion?.content,
  });
}
