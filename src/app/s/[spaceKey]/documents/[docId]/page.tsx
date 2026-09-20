import Link from 'next/link';
import { emptyDocument, type PMNode } from '@/domain/doc';
import { DocumentEditor } from '@/editor/document-editor';
import type { Diagnostic } from '@/domain/indexer';
import { requireSpace } from '@/server/authz';
import { listDocumentDiagnostics } from '@/server/repositories/requirements';
import { openDocument } from '@/server/usecases/documents';
import { suggestKeyAction } from '../../admin/keys/actions';
import { RequirementPopup } from '../../r/requirement-popup';
import { deleteDocumentAction, renameDocumentAction, saveDocumentAction } from '../actions';

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ spaceKey: string; docId: string }>;
}) {
  const { spaceKey, docId } = await params;
  const { can } = await requireSpace(spaceKey);
  const document = await openDocument(spaceKey, docId);
  const content = (document.currentVersion?.content as PMNode | undefined) ?? emptyDocument();
  const diagnostics: Diagnostic[] = (await listDocumentDiagnostics(docId)).map((row) => ({
    code: row.code as Diagnostic['code'],
    severity: row.severity === 'error' ? 'error' : 'warning',
    message: row.message,
    path: row.path,
    ...(row.key ? { key: row.key } : {}),
  }));

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-xl font-semibold tracking-tight">{document.title}</h1>
        <Link href={`/s/${spaceKey}/documents/${docId}/history`} className="text-sm text-[var(--rf-accent)]">
          History
        </Link>
        <Link href={`/s/${spaceKey}/documents`} className="text-sm text-[var(--rf-muted)]">
          All documents
        </Link>
      </div>

      {can('EDIT') ? (
        <div className="flex flex-wrap items-center gap-3">
          <form action={renameDocumentAction.bind(null, spaceKey)} className="flex items-center gap-2">
            <input type="hidden" name="documentId" value={docId} />
            <input
              name="title"
              defaultValue={document.title}
              aria-label="Document title"
              className="rounded border border-[var(--rf-line)] px-2 py-1 text-sm"
            />
            <button type="submit" className="rounded bg-[var(--rf-bg)] px-2 py-1 text-xs">
              Rename
            </button>
          </form>
          <form action={deleteDocumentAction.bind(null, spaceKey)}>
            <input type="hidden" name="documentId" value={docId} />
            <button type="submit" className="rounded bg-[var(--rf-bg)] px-2 py-1 text-xs text-red-600">
              Delete
            </button>
          </form>
        </div>
      ) : null}

      <RequirementPopup spaceKey={spaceKey}>
        <DocumentEditor
          documentId={docId}
          initialContent={content}
          currentVersion={document.currentVersion?.number ?? 1}
          canEdit={can('EDIT')}
          initialDiagnostics={diagnostics}
          onSave={saveDocumentAction.bind(null, spaceKey)}
          suggestKey={suggestKeyAction.bind(null, spaceKey, docId)}
        />
      </RequirementPopup>
    </main>
  );
}
