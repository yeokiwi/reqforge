import { Panel } from '@/app/_components/chrome';
import { requireSpace } from '@/server/authz';
import { listHistory } from '@/server/repositories/history';
import { HistorySettingsForm, PruneForm } from './settings-form';

/** spec: 05-baselines-and-diff.md §6 — off by default, because it is the largest table. */
export default async function HistoryAdminPage({ params }: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await params;
  const { space, can } = await requireSpace(spaceKey);
  const recent = space.historyEnabled ? await listHistory({ spaceId: space.id, limit: 100 }) : [];

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Change log</h1>
        <p className="text-sm text-[var(--rf-muted)]">
          Every change to a requirement, with the actor who made it — recorded in the same transaction as the
          change itself, so it can neither outlive a rollback nor name the wrong author. This is the
          per-requirement history of spec 05 §6; a document&rsquo;s own version list lives on the document.
        </p>
      </div>

      {can('ADMIN') ? (
        <Panel>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">Settings</h2>
          <div className="flex flex-col gap-3">
            <HistorySettingsForm
              spaceKey={spaceKey}
              historyEnabled={space.historyEnabled}
              retentionDays={space.historyRetentionDays}
            />
            <PruneForm spaceKey={spaceKey} />
          </div>
        </Panel>
      ) : null}

      <Panel>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">
          {space.historyEnabled ? 'Recent changes' : 'Not recording'}
        </h2>
        {space.historyEnabled ? (
          <table className="w-full text-sm" data-testid="history-table">
            <tbody>
              {recent.map((entry) => (
                <tr key={entry.id} className="border-t border-[var(--rf-line)] align-top">
                  <td className="w-44 py-1.5 text-xs text-[var(--rf-muted)]">{entry.at.toISOString()}</td>
                  <td className="w-28 py-1.5 font-mono text-xs">{entry.requirement.key}</td>
                  <td className="w-40 py-1.5 text-xs">{entry.changeKind}</td>
                  <td className="py-1.5 text-xs text-[var(--rf-muted)]">{entry.actorId}</td>
                </tr>
              ))}
              {recent.length === 0 ? (
                <tr>
                  <td className="py-3 text-[var(--rf-muted)]">Nothing recorded yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-[var(--rf-muted)]">
            History is off for this space. Turn it on above; it starts recording from the next save.
          </p>
        )}
      </Panel>
    </main>
  );
}
