import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/app/_components/action-form';
import { Panel } from '@/app/_components/chrome';
import { ForbiddenError, NotFoundError } from '@/domain/errors';
import { documentRestrictionUseCase } from '@/server/usecases/restrictions';
import { saveDocumentLabelAction, saveRestrictionAction } from './actions';
import { RestrictionEditor } from './restriction-editor';

/**
 * Who may see and change one document. spec: 07-permissions-and-limits.md §2.2 (rules
 * X1–X4) and §2.3 (its classification label). RD-056, RD-057, RD-060.
 */
export default async function DocumentRestrictionsPage({
  params,
}: {
  params: Promise<{ spaceKey: string; docId: string }>;
}) {
  const { spaceKey, docId } = await params;

  let loaded;
  try {
    loaded = await documentRestrictionUseCase(spaceKey, docId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) {
      return (
        <main className="mx-auto max-w-3xl px-6 py-12">
          <Panel>
            <h1 className="text-lg font-semibold tracking-tight">You cannot change who sees this document</h1>
            {/* Rendered, not thrown: a production build redacts a thrown message (RD-057). */}
            <p className="mt-2 text-sm text-[var(--rf-muted)]">{error.message}</p>
            <Link href={`/s/${spaceKey}/documents/${docId}`} className="mt-3 inline-block text-sm text-[var(--rf-accent)]">
              Back to the document
            </Link>
          </Panel>
        </main>
      );
    }
    throw error;
  }
  const { document, restriction, subjects, levels } = loaded;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-8">
      <div>
        <Link href={`/s/${spaceKey}/documents/${docId}`} className="text-sm text-[var(--rf-muted)]">
          ← {document.title}
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Restrictions</h1>
        <p className="text-sm text-[var(--rf-muted)]">
          A restriction reaches every requirement defined here, everywhere it would otherwise appear — search,
          matrices, coverage, reports, exports and baselines (spec 07 rule X1). Hidden requirements are left out,
          not greyed out.
        </p>
      </div>

      {restriction.inherited.length > 0 ? (
        <Panel>
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">Also restricted by</h2>
          <ul className="text-sm" data-testid="inherited-restrictions">
            {restriction.inherited.map((gate) => (
              <li key={gate.documentId}>
                <Link href={`/s/${spaceKey}/documents/${gate.documentId}/restrictions`} className="text-[var(--rf-accent)]">
                  {gate.title}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-[var(--rf-muted)]">
            A reader must pass these documents&rsquo; view lists as well as this one&rsquo;s.
          </p>
        </Panel>
      ) : null}

      <Panel>
        <RestrictionEditor
          action={saveRestrictionAction.bind(null, spaceKey, docId)}
          initialMode={restriction.mode}
          initialGrants={restriction.grants}
          users={subjects.users}
          groups={subjects.groups}
        />
      </Panel>

      <Panel>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">Classification</h2>
        <ActionForm action={saveDocumentLabelAction.bind(null, spaceKey, docId)} submitLabel="Save label">
          <select
            name="levelId"
            defaultValue={document.classificationId ?? ''}
            aria-label="Classification"
            className="rounded border border-[var(--rf-line)] px-2 py-1 text-sm"
          >
            <option value="">None of its own</option>
            {levels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.name}
              </option>
            ))}
          </select>
        </ActionForm>
        <p className="mt-1 text-xs text-[var(--rf-muted)]">
          Labels do not restrict anyone by themselves. The document shows the highest of its own, its space&rsquo;s and
          the content it embeds, and every export carries the highest label in it (spec 07 §2.3).
        </p>
      </Panel>
    </main>
  );
}
