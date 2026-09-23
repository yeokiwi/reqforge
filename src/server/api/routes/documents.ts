import { z } from 'zod/v4';
import { renderHtml, type PMNode } from '@/domain/doc';
import type { DocumentTreeNode } from '@/server/repositories/documents';
import {
  createDocumentUseCase,
  documentDiagnosticsUseCase,
  documentVersion,
  getDocumentTree,
  openDocument,
  reindexDocumentUseCase,
  saveDocumentUseCase,
} from '@/server/usecases/documents';
import { defineRoute } from '../define-route';
import { accepted, jobView, spaceKey, spaceParams } from '../schemas';

/** spec: 08-api-surface.md §3 — documents. */

const TAG = 'Documents';
const documentParams = z.object({ spaceKey, id: z.string().min(1).max(64) });

type TreeNode = { id: string; title: string; parentId: string | null; ordinal: number; children: TreeNode[] };
const treeNode: z.ZodType<TreeNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    title: z.string(),
    parentId: z.string().nullable(),
    ordinal: z.number().int(),
    children: z.array(treeNode),
  }),
);

const diagnostic = z.looseObject({
  code: z.string(),
  severity: z.enum(['error', 'warning']),
  message: z.string(),
  path: z.string(),
  key: z.string().optional(),
});

function countNodes(nodes: readonly DocumentTreeNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children), 0);
}

export const documentTree = defineRoute({
  method: 'GET',
  path: '/spaces/{spaceKey}/documents',
  tag: TAG,
  summary: 'The document tree, as far as the caller may see it',
  params: spaceParams,
  response: z.object({ items: z.array(treeNode), total: z.number().int() }),
  handler: async ({ params }) => {
    const items = await getDocumentTree(params.spaceKey);
    return { items, total: countNodes(items) };
  },
});

export const createDocument = defineRoute({
  method: 'POST',
  path: '/spaces/{spaceKey}/documents',
  tag: TAG,
  summary: 'Create a document (empty, or from a requirement type`s template)',
  status: 201,
  params: spaceParams,
  body: z.object({
    title: z.string().min(1).max(200),
    parentId: z.string().max(64).nullable().optional(),
    typeId: z.string().max(64).nullable().optional(),
  }),
  response: z.object({ id: z.string(), title: z.string(), parentId: z.string().nullable(), version: z.number().int() }),
  handler: async ({ params, body }) => {
    const created = await createDocumentUseCase({
      spaceKey: params.spaceKey,
      title: body.title,
      parentId: body.parentId ?? null,
      typeId: body.typeId ?? null,
    });
    return { id: created.id, title: created.title, parentId: created.parentId, version: created.currentVersion?.number ?? 1 };
  },
});

export const getDocument = defineRoute({
  method: 'GET',
  path: '/spaces/{spaceKey}/documents/{id}',
  tag: TAG,
  summary: 'A document version as ProseMirror JSON, or as HTML with `?format=html`',
  params: documentParams,
  query: z.object({
    version: z.coerce.number().int().positive().optional(),
    format: z.enum(['json', 'html']).default('json'),
  }),
  response: z.object({
    id: z.string(),
    title: z.string(),
    parentId: z.string().nullable(),
    restricted: z.boolean(),
    version: z.object({ number: z.number().int(), createdAt: z.string(), authorId: z.string(), message: z.string().nullable() }),
    content: z.unknown().optional(),
    html: z.string().optional(),
  }),
  handler: async ({ params, query }) => {
    const document = await openDocument(params.spaceKey, params.id);
    const version =
      query.version !== undefined
        ? (await documentVersion(params.spaceKey, params.id, query.version)).version
        : document.currentVersion;
    if (!version) throw new Error('A document always has a version.');
    const content = version.content as unknown as PMNode;
    return {
      id: document.id,
      title: document.title,
      parentId: document.parentId,
      restricted: document.restrictionMode === 'EXPLICIT',
      version: {
        number: version.number,
        createdAt: version.createdAt.toISOString(),
        authorId: version.authorId,
        message: version.message,
      },
      ...(query.format === 'html' ? { html: renderHtml(content) } : { content }),
    };
  },
});

export const putDocument = defineRoute({
  method: 'PUT',
  path: '/spaces/{spaceKey}/documents/{id}',
  tag: TAG,
  summary: 'Save a new version; indexes synchronously and returns the diagnostics',
  params: documentParams,
  body: z.object({ content: z.looseObject({ type: z.literal('doc') }), message: z.string().max(500).nullable().optional() }),
  response: z.object({
    version: z.number().int(),
    requirements: z.object({ created: z.number().int(), updated: z.number().int(), deleted: z.number().int() }),
    diagnostics: z.array(diagnostic),
    /** True when any diagnostic is an error — what a CI job checks (spec 08 §3). */
    valid: z.boolean(),
  }),
  handler: async ({ params, body }) => {
    const outcome = await saveDocumentUseCase({
      spaceKey: params.spaceKey,
      documentId: params.id,
      content: body.content,
      message: body.message ?? null,
    });
    return {
      version: outcome.versionNumber,
      requirements: outcome.requirements,
      diagnostics: outcome.diagnostics,
      valid: !outcome.diagnostics.some((entry) => entry.severity === 'error'),
    };
  },
});

export const reindexDocument = defineRoute({
  method: 'POST',
  path: '/spaces/{spaceKey}/documents/{id}/reindex',
  tag: TAG,
  summary: 'Reindex the current version (no new version) — returns a job',
  status: 202,
  params: documentParams,
  response: accepted,
  handler: async ({ params }) => ({ job: jobView(await reindexDocumentUseCase(params.spaceKey, params.id)) }),
});

export const documentDiagnostics = defineRoute({
  method: 'GET',
  path: '/spaces/{spaceKey}/documents/{id}/diagnostics',
  tag: TAG,
  summary: 'Indexer diagnostics for a document',
  params: documentParams,
  response: z.object({ items: z.array(diagnostic) }),
  handler: async ({ params }) => {
    const rows = await documentDiagnosticsUseCase(params.spaceKey, params.id);
    return {
      items: rows.map((row) => ({
        code: row.code,
        severity: row.severity === 'error' ? ('error' as const) : ('warning' as const),
        message: row.message,
        path: row.path,
        ...(row.key ? { key: row.key } : {}),
      })),
    };
  },
});

export const documentRoutes = [documentTree, createDocument, getDocument, putDocument, reindexDocument, documentDiagnostics];
