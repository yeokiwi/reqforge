import { Panel } from '@/app/_components/chrome';
import { PermissionRequired } from '@/app/_components/permission-required';
import { requireSpace } from '@/server/authz';
import { auditLogUseCase } from '@/server/usecases/audit';

/**
 * spec: 07-permissions-and-limits.md §6 — "Freeze, refreeze, rename, restriction change,
 * permission change and export are the operations an auditor will ask about, and each
 * must be reconstructable from the audit log alone." RD-062.
 */
export default async function AuditLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ spaceKey: string }>;
  searchParams: Promise<{ operation?: string; actor?: string; since?: string; until?: string }>;
}) {
  const { spaceKey } = await params;
  const filter = await searchParams;
  const { can } = await requireSpace(spaceKey);
  if (!can('ADMIN')) return <PermissionRequired spaceKey={spaceKey} permission="ADMIN" what="Reading the audit log" />;

  const { events, operations } = await auditLogUseCase(spaceKey, {
    ...(filter.operation ? { operation: filter.operation } : {}),
    ...(filter.actor ? { actorEmail: filter.actor } : {}),
    ...(filter.since ? { since: filter.since } : {}),
    ...(filter.until ? { until: filter.until } : {}),
  });

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-[var(--rf-muted)]">
          Append-only, never pruned. Identifiers and parameters only — no requirement text.
        </p>
      </div>
      <Panel>
        <form className="flex flex-wrap items-center gap-2 text-sm">
          <select name="operation" defaultValue={filter.operation ?? ''} aria-label="Operation" className="rounded border border-[var(--rf-line)] px-2 py-1">
            <option value="">Every operation</option>
            {operations.map((operation) => (
              <option key={operation} value={operation}>
                {operation}
              </option>
            ))}
          </select>
          <input name="actor" defaultValue={filter.actor ?? ''} placeholder="actor email" aria-label="Actor" className="rounded border border-[var(--rf-line)] px-2 py-1" />
          <input name="since" type="date" defaultValue={filter.since ?? ''} aria-label="Since" className="rounded border border-[var(--rf-line)] px-2 py-1" />
          <input name="until" type="date" defaultValue={filter.until ?? ''} aria-label="Until" className="rounded border border-[var(--rf-line)] px-2 py-1" />
          <button type="submit" className="rounded bg-[var(--rf-accent)] px-3 py-1 text-xs font-medium text-white">
            Filter
          </button>
        </form>
      </Panel>
      <Panel>
        <table className="w-full text-sm" data-testid="audit-table">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--rf-muted)]">
              <th className="w-48 pb-2">When</th>
              <th className="w-48 pb-2">Who</th>
              <th className="w-44 pb-2">What</th>
              <th className="pb-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-t border-[var(--rf-line)] align-top">
                <td className="py-1.5 text-xs text-[var(--rf-muted)]">{event.at.toISOString()}</td>
                <td className="py-1.5 text-xs">{event.actor ? `${event.actor.name} <${event.actor.email}>` : event.actorId}</td>
                <td className="py-1.5 text-xs">
                  {event.objectType} · <span className="font-medium">{event.operation}</span>
                </td>
                <td className="py-1.5">
                  <code className="block max-w-xl overflow-x-auto whitespace-pre-wrap break-all text-xs text-[var(--rf-muted)]">
                    {JSON.stringify(event.parameters)}
                  </code>
                </td>
              </tr>
            ))}
            {events.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-3 text-[var(--rf-muted)]">Nothing recorded for that filter.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Panel>
    </main>
  );
}
