import Link from 'next/link';
import { ActionForm } from '@/app/_components/action-form';
import { Panel, TopBar } from '@/app/_components/chrome';
import { instanceAdminOrRefusal } from '@/app/_components/instance-admin';
import { limitsOverviewUseCase } from '@/server/usecases/limits';
import { saveSpaceLimitsAction } from './actions';

const OVERRIDE_NOTE = {
  any: 'raise or lower',
  'lower-only': 'lower only',
  fixed: 'fixed',
} as const;

/**
 * spec: 07-permissions-and-limits.md §4 — "Configured per installation with per-space
 * overrides." The installation's values come from `REQFORGE_LIMITS`; this screen sets a
 * space's overrides. RD-071.
 */
export default async function LimitsPage({ searchParams }: { searchParams: Promise<{ space?: string }> }) {
  const gate = await instanceAdminOrRefusal('manage limits');
  if ('refusal' in gate) return gate.refusal;
  const { rows, spaces } = await limitsOverviewUseCase();
  const { space: requested } = await searchParams;
  const selected = spaces.find((space) => space.key === requested) ?? spaces[0] ?? null;

  return (
    <>
      <TopBar userName={gate.user.name} />
      <main className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Limits</h1>
          <p className="text-sm text-[var(--rf-muted)]">
            Exceeding a hard limit is refused with the limit named; a warning threshold only adds a diagnostic. The
            installation column comes from the <code>REQFORGE_LIMITS</code> environment variable. A space override replaces it
            for that space. Limits whose code paths are sized for their default can only be lowered.
          </p>
        </div>

        <Panel>
          <div className="flex flex-wrap gap-2 text-sm" data-testid="limit-spaces">
            {spaces.map((space) => (
              <Link
                key={space.key}
                href={`/admin/limits?space=${encodeURIComponent(space.key)}`}
                className={space.key === selected?.key ? 'rounded bg-[var(--rf-accent)] px-2 py-1 text-white' : 'rounded px-2 py-1 text-[var(--rf-accent)]'}
              >
                {space.key}
                {Object.keys(space.overrides).length > 0 ? ` (${Object.keys(space.overrides).length})` : ''}
              </Link>
            ))}
          </div>
        </Panel>

        {selected ? (
          <Panel>
            <ActionForm
              action={saveSpaceLimitsAction.bind(null, selected.key)}
              submitLabel={`Save overrides for ${selected.key}`}
              testId="limit-form"
              className="flex flex-col gap-3"
            >
              <table className="w-full text-sm" data-testid="limit-table">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--rf-muted)]">
                    <th className="pb-2">Limit</th>
                    <th className="pb-2">Spec default</th>
                    <th className="pb-2">Installation</th>
                    <th className="pb-2">{selected.key} override</th>
                    <th className="pb-2">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-[var(--rf-line)]">
                      <td className="py-1.5">
                        {row.label}
                        {row.kind === 'warning' ? <span className="ml-1 text-xs text-amber-700">warning</span> : null}
                      </td>
                      <td className="py-1.5 tabular-nums">{row.specDefault.toLocaleString('en-US')}</td>
                      <td className="py-1.5 tabular-nums">{row.installation.toLocaleString('en-US')}</td>
                      <td className="py-1.5">
                        {row.override === 'fixed' ? (
                          <span className="text-xs text-[var(--rf-muted)]">fixed</span>
                        ) : (
                          <input
                            type="number"
                            name={row.id}
                            min={1}
                            max={row.override === 'lower-only' ? row.specDefault : undefined}
                            defaultValue={selected.overrides[row.id] ?? ''}
                            aria-label={`${row.label} override`}
                            placeholder={OVERRIDE_NOTE[row.override]}
                            className="w-32 rounded border border-[var(--rf-line)] px-2 py-1 text-sm"
                          />
                        )}
                      </td>
                      <td className="py-1.5 text-xs text-[var(--rf-muted)]">{row.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ActionForm>
          </Panel>
        ) : null}
      </main>
    </>
  );
}
