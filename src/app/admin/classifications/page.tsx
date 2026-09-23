import { ActionForm } from '@/app/_components/action-form';
import { Panel, TopBar } from '@/app/_components/chrome';
import { instanceAdminOrRefusal } from '@/app/_components/instance-admin';
import { listLevelsUseCase } from '@/server/usecases/classification';
import { createLevelAction, deleteLevelAction, moveLevelAction, renameLevelAction } from './actions';

/**
 * Classification labels, instance-wide and ordered. spec: 07-permissions-and-limits.md
 * §2.3 — "free text configured per installation"; RD-060 — ordered, so that "the label
 * of the highest-classified content" is defined.
 */
export default async function ClassificationsPage() {
  const gate = await instanceAdminOrRefusal('manage classification labels');
  if ('refusal' in gate) return gate.refusal;
  const levels = await listLevelsUseCase();
  const order = levels.map((level) => level.id).join(',');
  // Shown most restrictive first, which is how people read a scale of sensitivity.
  const shown = [...levels].reverse();

  return (
    <>
      <TopBar userName={gate.user.name} />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Classification labels</h1>
          <p className="text-sm text-[var(--rf-muted)]">
            Most restrictive first. A document shows the highest of its own label, its space&rsquo;s and the content it
            embeds; every export carries the highest label of anything in it. Labels do not restrict access by
            themselves.
          </p>
        </div>
        <Panel>
          <ActionForm action={createLevelAction} submitLabel="Add label" testId="create-level">
            <input name="name" placeholder="e.g. Official-Sensitive" aria-label="Label" className="w-64 rounded border border-[var(--rf-line)] px-2 py-1 text-sm" />
          </ActionForm>
        </Panel>
        <Panel>
          <ol className="flex flex-col gap-2" data-testid="level-list">
            {shown.map((level) => (
              <li key={level.id} className="flex flex-wrap items-center gap-2 border-t border-[var(--rf-line)] pt-2">
                <ActionForm action={renameLevelAction} submitLabel="Rename">
                  <input type="hidden" name="id" value={level.id} />
                  <input name="name" defaultValue={level.name} aria-label={`Rename ${level.name}`} className="w-56 rounded border border-[var(--rf-line)] px-2 py-1 text-sm" />
                </ActionForm>
                <ActionForm action={moveLevelAction} submitLabel="More restrictive">
                  <input type="hidden" name="id" value={level.id} />
                  <input type="hidden" name="order" value={order} />
                  <input type="hidden" name="direction" value="up" />
                </ActionForm>
                <ActionForm action={moveLevelAction} submitLabel="Less restrictive">
                  <input type="hidden" name="id" value={level.id} />
                  <input type="hidden" name="order" value={order} />
                  <input type="hidden" name="direction" value="down" />
                </ActionForm>
                <ActionForm action={deleteLevelAction} submitLabel="Delete" danger>
                  <input type="hidden" name="id" value={level.id} />
                </ActionForm>
              </li>
            ))}
            {levels.length === 0 ? <li className="text-sm text-[var(--rf-muted)]">No labels yet.</li> : null}
          </ol>
        </Panel>
      </main>
    </>
  );
}
