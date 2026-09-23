import { ActionForm } from '@/app/_components/action-form';
import { Panel } from '@/app/_components/chrome';
import { PermissionRequired } from '@/app/_components/permission-required';
import { requireSpace } from '@/server/authz';
import { listRestrictedDocumentsUseCase } from '@/server/usecases/restrictions';
import { unlockDocumentAction } from './actions';

/**
 * RD-058 — restricted documents, by title only. An administrator cannot read a restricted
 * document, but can remove its restriction: that is how a document restricted to someone
 * who has left is recovered. Every unlock is audited (spec 07 §6).
 */
export default async function RestrictedDocumentsPage({ params }: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await params;
  const { can } = await requireSpace(spaceKey);
  if (!can('ADMIN')) return <PermissionRequired spaceKey={spaceKey} permission="ADMIN" what="Unlocking documents" />;

  const documents = await listRestrictedDocumentsUseCase(spaceKey);
  const unlock = unlockDocumentAction.bind(null, spaceKey);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Restricted documents</h1>
        <p className="text-sm text-[var(--rf-muted)]">
          Titles only. Administering the space does not let you read these; removing a restriction does, for everyone
          with VIEW — so it is recorded in the audit log.
        </p>
      </div>
      <Panel>
        <table className="w-full text-sm" data-testid="restricted-documents">
          <tbody>
            {documents.map((document) => (
              <tr key={document.id} className="border-t border-[var(--rf-line)]">
                <td className="py-1.5">{document.title}</td>
                <td className="w-40 py-1.5 text-xs text-[var(--rf-muted)]">
                  {document.viewers} can view · {document.editors} can edit
                </td>
                <td className="w-56 py-1.5">
                  <ActionForm action={unlock} submitLabel="Remove restriction" danger>
                    <input type="hidden" name="documentId" value={document.id} />
                  </ActionForm>
                </td>
              </tr>
            ))}
            {documents.length === 0 ? (
              <tr>
                <td className="py-3 text-[var(--rf-muted)]">No document in this space is restricted.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Panel>
    </main>
  );
}
