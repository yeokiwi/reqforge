import { isPMNode, type PMNode } from '@/domain/doc';
import { NotFoundError, ValidationError } from '@/domain/errors';
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

export async function saveDocumentUseCase(input: {
  spaceKey: string;
  documentId: string;
  content: unknown;
  message?: string | null;
}): Promise<{ versionNumber: number }> {
  const { space, user } = await requireSpace(input.spaceKey, 'EDIT');

  if (!isPMNode(input.content) || input.content.type !== 'doc') {
    throw new ValidationError('The document body must be a ProseMirror `doc` node.');
  }
  const document = await findDocument(space.id, input.documentId);
  if (!document) throw new NotFoundError('That document no longer exists.');

  const version = await saveDocumentVersion({
    documentId: document.id,
    content: input.content as PMNode,
    authorId: user.id,
    message: input.message ?? null,
  });

  return { versionNumber: version.number };
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
