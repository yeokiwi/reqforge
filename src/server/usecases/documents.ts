import { isPMNode, type PMNode } from '@/domain/doc';
import { ForbiddenError, NotFoundError, ValidationError } from '@/domain/errors';
import { indexDocumentVersion, type Diagnostic } from '@/domain/indexer';
import { templateDocument } from '@/domain/validation';
import { applyIndexResult, listDocumentDiagnostics } from '@/server/repositories/requirements';
import { labelDocument } from './classification';
import {
  findTypeWithRules,
  listTypesWithRules,
  rulesOf,
  templateColumnsOf,
} from '@/server/repositories/requirement-types';
import { requireSpace } from '@/server/authz';
import { recordAuditEvent } from '@/server/repositories/audit';
import { isDocumentEditable } from '@/server/repositories/visibility';
import {
  createDocument,
  findDocument,
  findVersion,
  listDocumentTree,
  listVersions,
  moveDocument,
  renameDocument,
  saveDocumentVersion,
  softDeleteDocument,
  type DocumentTreeNode,
  type DocumentWithVersion,
} from '@/server/repositories/documents';

const TITLE_MAX = 200;

function cleanTitle(raw: unknown): string {
  const title = typeof raw === 'string' ? raw.trim() : '';
  if (title.length === 0) throw new ValidationError('A document needs a title.');
  if (title.length > TITLE_MAX) throw new ValidationError(`A title may be at most ${TITLE_MAX} characters.`);
  return title;
}

export async function getDocumentTree(spaceKey: string): Promise<DocumentTreeNode[]> {
  const { space, viewer } = await requireSpace(spaceKey);
  return listDocumentTree(viewer, space.id);
}

export async function openDocument(spaceKey: string, documentId: string): Promise<DocumentWithVersion> {
  const { space, viewer } = await requireSpace(spaceKey);
  // RD-064 — "no longer exists" for a hidden document too: the two must read the same.
  const document = await findDocument(viewer, space.id, documentId);
  if (!document) throw new NotFoundError('That document no longer exists.');
  return document;
}

/** The document's diagnostics as this reader may see them (rule X2). */
export async function documentDiagnosticsUseCase(spaceKey: string, documentId: string) {
  const { space, viewer } = await requireSpace(spaceKey);
  if (!(await findDocument(viewer, space.id, documentId))) throw new NotFoundError('That document no longer exists.');
  return listDocumentDiagnostics(viewer, space.id, documentId);
}

/** spec 07 §2.3 — labelling a document is part of editing it. */
export async function labelDocumentUseCase(spaceKey: string, documentId: string, levelId: string | null): Promise<void> {
  const { space, user } = await requireEditableDocument(spaceKey, documentId);
  await labelDocument({ spaceId: space.id, documentId, actorId: user.id, levelId });
}

/** Whether this reader may change the document, for the editor's read-only state. */
export async function canEditDocument(spaceKey: string, documentId: string): Promise<boolean> {
  const { viewer, can } = await requireSpace(spaceKey);
  return can('EDIT') && (await isDocumentEditable(viewer, documentId));
}

/**
 * Every change to a document needs space EDIT **and** the document's own edit list, where
 * it has one (spec 07 §2.2). A document the reader cannot see answers "no longer exists"
 * rather than "forbidden" (RD-064).
 */
async function requireEditableDocument(spaceKey: string, documentId: string) {
  const context = await requireSpace(spaceKey, 'EDIT');
  const document = await findDocument(context.viewer, context.space.id, documentId);
  if (!document) throw new NotFoundError('That document no longer exists.');
  if (!(await isDocumentEditable(context.viewer, documentId))) {
    throw new ForbiddenError('This document is restricted: you may read it but not change it.');
  }
  return { ...context, document };
}

export async function createDocumentUseCase(input: {
  spaceKey: string;
  title: unknown;
  parentId?: string | null;
  /** spec 06 §3 — "a document skeleton with one correctly-shaped table". */
  typeId?: string | null;
}): Promise<DocumentWithVersion> {
  const { space, user, viewer } = await requireSpace(input.spaceKey, 'EDIT');

  // A child cannot be hung under a parent the author cannot see (RD-064).
  if (input.parentId && !(await findDocument(viewer, space.id, input.parentId))) {
    throw new NotFoundError('That parent document no longer exists.');
  }

  const type = input.typeId ? await findTypeWithRules(space.id, input.typeId) : null;
  const columns = type ? templateColumnsOf(type) : [];

  return createDocument({
    spaceId: space.id,
    title: cleanTitle(input.title),
    parentId: input.parentId ?? null,
    authorId: user.id,
    ...(columns.length > 0 ? { content: templateDocument(columns) } : {}),
  });
}

export type SaveOutcome = {
  versionNumber: number;
  diagnostics: Diagnostic[];
  requirements: { created: number; updated: number; deleted: number };
};

/**
 * Saving is indexing. The new version and the requirement rows it projects are written in
 * one transaction, so a requirement can never reference a version that does not exist and
 * the history row carries the editing actor (RD-014).
 * spec: 00-overview.md decision 2; 03-authoring-and-indexing.md §3
 */
export async function saveDocumentUseCase(input: {
  spaceKey: string;
  documentId: string;
  content: unknown;
  message?: string | null;
}): Promise<SaveOutcome> {
  if (!isPMNode(input.content) || input.content.type !== 'doc') {
    throw new ValidationError('The document body must be a ProseMirror `doc` node.');
  }
  // spec 07 §2.2 — the document's own edit list applies on top of space EDIT.
  const { space, user, document } = await requireEditableDocument(input.spaceKey, input.documentId);

  const content = input.content as PMNode;
  // With their rules: validation runs on every save (spec 06 §2.2 trigger 1) from data
  // already in hand, so it costs no query per requirement.
  const types = await listTypesWithRules(space.id);
  const indexed = indexDocumentVersion({
    content,
    space: {
      key: space.key,
      types: types.map((type) => ({
        id: type.id,
        name: type.name,
        keyPattern: type.keyPattern,
        locked: type.locked,
      })),
    },
  });

  let outcome = { created: [] as string[], updated: [] as string[], deleted: [] as string[], diagnostics: indexed.diagnostics };

  const version = await saveDocumentVersion({
    documentId: document.id,
    content,
    authorId: user.id,
    message: input.message ?? null,
    onVersion: async (tx, created) => {
      outcome = await applyIndexResult(tx, {
        spaceId: space.id,
        spaceKey: space.key,
        isolated: space.isolated,
        documentId: document.id,
        versionId: created.id,
        actorId: user.id,
        result: indexed,
        types: types.map((type) => ({ id: type.id, rules: rulesOf(type) })),
        historyEnabled: space.historyEnabled,
      });
    },
  });

  return {
    versionNumber: version.number,
    diagnostics: outcome.diagnostics,
    requirements: {
      created: outcome.created.length,
      updated: outcome.updated.length,
      deleted: outcome.deleted.length,
    },
  };
}

export async function renameDocumentUseCase(spaceKey: string, documentId: string, title: unknown): Promise<void> {
  const { space } = await requireEditableDocument(spaceKey, documentId);
  await renameDocument(space.id, documentId, cleanTitle(title));
}

export async function moveDocumentUseCase(
  spaceKey: string,
  documentId: string,
  parentId: string | null,
): Promise<void> {
  const { space, viewer, user } = await requireEditableDocument(spaceKey, documentId);
  if (parentId && !(await findDocument(viewer, space.id, parentId))) {
    throw new NotFoundError('That parent document no longer exists.');
  }
  await moveDocument(space.id, documentId, parentId);
  // spec 07 §6 / RD-062 — a move can change who may see a whole subtree.
  await recordAuditEvent({
    actorId: user.id,
    spaceId: space.id,
    objectType: 'Document',
    objectId: documentId,
    operation: 'move',
    parameters: { parentId },
  });
}

export async function deleteDocumentUseCase(spaceKey: string, documentId: string): Promise<void> {
  const { space, user, document } = await requireEditableDocument(spaceKey, documentId);
  await softDeleteDocument(space.id, documentId, user.id);
  await recordAuditEvent({
    actorId: user.id,
    spaceId: space.id,
    objectType: 'Document',
    objectId: documentId,
    operation: 'delete',
    parameters: { title: document.title },
  });
}

export async function documentHistory(spaceKey: string, documentId: string) {
  const { space, viewer } = await requireSpace(spaceKey);
  const document = await findDocument(viewer, space.id, documentId);
  if (!document) throw new NotFoundError('That document no longer exists.');
  return { document, versions: await listVersions(documentId) };
}

export async function documentVersion(spaceKey: string, documentId: string, number: number) {
  const { space, viewer } = await requireSpace(spaceKey);
  const document = await findDocument(viewer, space.id, documentId);
  if (!document) throw new NotFoundError('That document no longer exists.');
  const version = await findVersion(documentId, number);
  if (!version) throw new NotFoundError(`Version ${number} does not exist.`);
  return { document, version };
}
