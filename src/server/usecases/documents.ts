import { isPMNode, type PMNode } from '@/domain/doc';
import { NotFoundError, ValidationError } from '@/domain/errors';
import { indexDocumentVersion, type Diagnostic } from '@/domain/indexer';
import { applyIndexResult } from '@/server/repositories/requirements';
import { requireSpace } from '@/server/authz';
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
  const { space } = await requireSpace(spaceKey);
  return listDocumentTree(space.id);
}

export async function openDocument(spaceKey: string, documentId: string): Promise<DocumentWithVersion> {
  const { space } = await requireSpace(spaceKey);
  const document = await findDocument(space.id, documentId);
  if (!document) throw new NotFoundError('That document no longer exists.');
  return document;
}

export async function createDocumentUseCase(input: {
  spaceKey: string;
  title: unknown;
  parentId?: string | null;
}): Promise<DocumentWithVersion> {
  const { space, user } = await requireSpace(input.spaceKey, 'EDIT');
  return createDocument({
    spaceId: space.id,
    title: cleanTitle(input.title),
    parentId: input.parentId ?? null,
    authorId: user.id,
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
  const { space, user } = await requireSpace(input.spaceKey, 'EDIT');

  if (!isPMNode(input.content) || input.content.type !== 'doc') {
    throw new ValidationError('The document body must be a ProseMirror `doc` node.');
  }
  const document = await findDocument(space.id, input.documentId);
  if (!document) throw new NotFoundError('That document no longer exists.');

  const content = input.content as PMNode;
  const indexed = indexDocumentVersion({ content, space: { key: space.key } });

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
        documentId: document.id,
        versionId: created.id,
        actorId: user.id,
        result: indexed,
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
  const { space } = await requireSpace(spaceKey, 'EDIT');
  await renameDocument(space.id, documentId, cleanTitle(title));
}

export async function moveDocumentUseCase(
  spaceKey: string,
  documentId: string,
  parentId: string | null,
): Promise<void> {
  const { space } = await requireSpace(spaceKey, 'EDIT');
  await moveDocument(space.id, documentId, parentId);
}

export async function deleteDocumentUseCase(spaceKey: string, documentId: string): Promise<void> {
  const { space } = await requireSpace(spaceKey, 'EDIT');
  await softDeleteDocument(space.id, documentId);
}

export async function documentHistory(spaceKey: string, documentId: string) {
  const { space } = await requireSpace(spaceKey);
  const document = await findDocument(space.id, documentId);
  if (!document) throw new NotFoundError('That document no longer exists.');
  return { document, versions: await listVersions(documentId) };
}

export async function documentVersion(spaceKey: string, documentId: string, number: number) {
  const { space } = await requireSpace(spaceKey);
  const document = await findDocument(space.id, documentId);
  if (!document) throw new NotFoundError('That document no longer exists.');
  const version = await findVersion(documentId, number);
  if (!version) throw new NotFoundError(`Version ${number} does not exist.`);
  return { document, version };
}
