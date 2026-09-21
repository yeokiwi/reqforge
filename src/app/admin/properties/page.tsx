import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TopBar, Panel } from '@/app/_components/chrome';
import { AuthenticationError, ForbiddenError } from '@/domain/errors';
import { DATA_TYPE_LABELS } from '@/domain/properties/external';
import { requireUser } from '@/server/authz';
import { listDefinitionsWithUsage, type DefinitionView } from '@/server/usecases/external-properties';
import { DefinitionForm, DeleteDefinitionForm } from './definition-form';

/**
 * External property definitions, instance-wide.
 * spec: 01-domain-model.md (ExternalPropertyDefinition); RD-036 — instance-global, so an
 * instance administrator owns them rather than any one space's administrator.
 */
export default async function ExternalPropertiesPage() {
  let userName = '';
  let definitions: DefinitionView[] = [];

  try {
    userName = (await requireUser()).name;
    definitions = await listDefinitionsWithUsage();
  } catch (error) {
    if (error instanceof AuthenticationError) redirect('/login');
    if (error instanceof ForbiddenError) {
      return (
        <>
          <TopBar userName={userName} />
          <main className="mx-auto max-w-3xl px-6 py-12">
            <Panel>
              <h1 className="text-lg font-semibold tracking-tight">Instance administrators only</h1>
              {/* Rendered rather than thrown: a production build redacts a thrown message,
                  and this is exactly the message the reader needs (RD-036). */}
              <p className="mt-2 text-sm text-[var(--rf-muted)]">{error.message}</p>
              <Link href="/spaces" className="mt-3 inline-block text-sm text-[var(--rf-accent)]">
                Back to your spaces
              </Link>
            </Panel>
          </main>
        </>
      );
    }
    throw error;
  }

  return (
    <>
      <TopBar userName={userName} />
      <main className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">External properties</h1>
          <p className="text-sm text-[var(--rf-muted)]">
            Values owned by the reader rather than by the document: they survive a reindex, a rename and a
            document deletion, and they are not captured in a baseline. Definitions are shared by every space
            (spec 01).
          </p>
        </div>

        <Panel>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">
            Define a property
          </h2>
          <DefinitionForm />
        </Panel>

        <Panel>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">
            {definitions.length} defined
          </h2>
          <ul className="flex flex-col gap-4" data-testid="definition-list">
            {definitions.map((definition) => (
              <li key={definition.id} className="flex flex-col gap-2 border-t border-[var(--rf-line)] pt-3">
                <div className="flex items-center gap-3 text-xs text-[var(--rf-muted)]">
                  <span className="font-mono">ext@{definition.name}</span>
                  <span>{DATA_TYPE_LABELS[definition.dataType]}</span>
                  <span data-testid={`value-count-${definition.id}`}>
                    {definition.valueCount} value{definition.valueCount === 1 ? '' : 's'}
                  </span>
                  <span className="flex-1" />
                  <DeleteDefinitionForm id={definition.id} valueCount={definition.valueCount} />
                </div>
                <DefinitionForm definition={definition} valueCount={definition.valueCount} />
              </li>
            ))}
            {definitions.length === 0 ? (
              <li className="text-sm text-[var(--rf-muted)]">None yet.</li>
            ) : null}
          </ul>
        </Panel>
      </main>
    </>
  );
}
