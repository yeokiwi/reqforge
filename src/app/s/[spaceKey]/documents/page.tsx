import Link from 'next/link';
import { Panel } from '@/app/_components/chrome';
import { requireSpace } from '@/server/authz';
import { getDocumentTree } from '@/server/usecases/documents';
import type { DocumentTreeNode } from '@/server/repositories/documents';
import { CreateDocumentForm } from './create-document-form';
import { typesForEditor } from '@/server/usecases/requirement-types';

function Branch({ nodes, spaceKey, depth = 0 }: { nodes: DocumentTreeNode[]; spaceKey: string; depth?: number }) {
  return (
    <ul className={depth === 0 ? 'flex flex-col gap-1' : 'ml-5 flex flex-col gap-1 border-l border-[var(--rf-line)] pl-3'}>
      {nodes.map((node) => (
        <li key={node.id}>
          <Link
            href={`/s/${spaceKey}/documents/${node.id}`}
            className="block rounded px-2 py-1 text-sm hover:bg-[var(--rf-bg)]"
          >
            {node.title}
          </Link>
          {node.children.length > 0 ? (
            <Branch nodes={node.children} spaceKey={spaceKey} depth={depth + 1} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default async function DocumentsPage({ params }: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await params;
  const { can } = await requireSpace(spaceKey);
  const tree = await getDocumentTree(spaceKey);
  // spec 06 §3 — only types that actually scaffold something are worth offering.
  const templates = (await typesForEditor(spaceKey))
    .filter((type) => type.templateColumns.length > 0)
    .map((type) => ({ id: type.id, label: `${type.name ?? type.keyPattern} template` }));

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-8">
      <h1 className="text-xl font-semibold tracking-tight">Documents</h1>
      {can('EDIT') ? (
        <Panel>
          <CreateDocumentForm spaceKey={spaceKey} templates={templates} />
        </Panel>
      ) : null}
      <Panel>
        {tree.length === 0 ? (
          <p className="text-sm text-[var(--rf-muted)]">No documents yet.</p>
        ) : (
          <Branch nodes={tree} spaceKey={spaceKey} />
        )}
      </Panel>
    </main>
  );
}
