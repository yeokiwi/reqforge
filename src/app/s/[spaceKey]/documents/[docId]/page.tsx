import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NotFoundError } from '@/domain/errors';
import { emptyDocument, type PMNode } from '@/domain/doc';
import { DocumentEditor } from '@/editor/document-editor';
import type { Diagnostic } from '@/domain/indexer';
import { requireSpace } from '@/server/authz';
import { effectiveDocumentLabel } from '@/server/usecases/classification';
import { canEditDocument, documentDiagnosticsUseCase, openDocument } from '@/server/usecases/documents';
import { typesForEditor } from '@/server/usecases/requirement-types';
import { listMatricesUseCase } from '@/server/usecases/matrix';
import { suggestKeyAction } from '../../admin/keys/actions';
import { findRequirementsAction } from '../link-actions';
import { renderEmbeddedMatrixAction } from '../matrix-actions';
import { renderReportAction } from '../report-actions';
import { RequirementPopup } from '../../r/requirement-popup';
import { deleteDocumentAction, renameDocumentAction, saveDocumentAction } from '../actions';

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ spaceKey: string; docId: string }>;
}) {
  const { spaceKey, docId } = await params;
  const { space, viewer } = await requireSpace(spaceKey);
  let document;
  try {
    document = await openDocument(spaceKey, docId);
  } catch (error) {
    // RD-064 — a hidden document is a 404, exactly like one that never existed.
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  // spec 07 §2.2 — space EDIT and the document's own edit list.
  const editable = await canEditDocument(spaceKey, docId);
  // spec 07 §2.3 — the highest of its own, its space's and what it embeds, for this reader.
  const label = await effectiveDocumentLabel({
    viewer,
    space: { id: space.id, key: space.key, isolated: space.isolated },
    documentId: docId,
    content: document.currentVersion?.content,
  });
  const content = (document.currentVersion?.content as PMNode | undefined) ?? emptyDocument();
  const matrices = await listMatricesUseCase(spaceKey);
  const diagnostics: Diagnostic[] = (await documentDiagnosticsUseCase(spaceKey, docId)).map((row) => ({
    code: row.code as Diagnostic['code'],
    severity: row.severity === 'error' ? 'error' : 'warning',
    message: row.message,
    path: row.path,
    ...(row.key ? { key: row.key } : {}),
    // Stored as JSON, so a reopened document keeps its Fix buttons (RD-042).
    ...(row.fix ? { fix: row.fix as unknown as Diagnostic['fix'] } : {}),
  }));
  const types = await typesForEditor(spaceKey);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-xl font-semibold tracking-tight">{document.title}</h1>
        {label ? (
          <span data-testid="document-classification" className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
            {label.name}
          </span>
        ) : null}
        {document.restrictionMode === 'EXPLICIT' ? (
          <span data-testid="document-restricted" className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-700">
            Restricted
          </span>
        ) : null}
        <Link href={`/s/${spaceKey}/documents/${docId}/history`} className="text-sm text-[var(--rf-accent)]">
          History
        </Link>
        {editable ? (
          <Link href={`/s/${spaceKey}/documents/${docId}/restrictions`} className="text-sm text-[var(--rf-accent)]">
            Restrictions
          </Link>
        ) : null}
        <Link href={`/s/${spaceKey}/documents`} className="text-sm text-[var(--rf-muted)]">
          All documents
        </Link>
      </div>

      {editable ? (
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
          canEdit={editable}
          initialDiagnostics={diagnostics}
          onSave={saveDocumentAction.bind(null, spaceKey)}
          suggestKey={suggestKeyAction.bind(null, spaceKey, docId)}
          findRequirements={findRequirementsAction.bind(null, spaceKey)}
          matrices={matrices.map((matrix) => ({ id: matrix.id, name: matrix.name }))}
          renderMatrix={renderEmbeddedMatrixAction.bind(null, spaceKey, docId)}
          renderReport={renderReportAction.bind(null, spaceKey, docId)}
          types={types}
        />
      </RequirementPopup>
    </main>
  );
}
