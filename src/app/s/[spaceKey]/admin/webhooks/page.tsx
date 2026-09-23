import { ActionForm } from '@/app/_components/action-form';
import { Panel } from '@/app/_components/chrome';
import { PermissionRequired } from '@/app/_components/permission-required';
import { requireSpace } from '@/server/authz';
import { listDeliveriesUseCase, listWebhooksUseCase } from '@/server/usecases/webhooks';
import { deleteHookAction, redeliverAction } from './actions';
import { CreateHookForm } from './create-hook-form';

/**
 * spec: 08-api-surface.md §7 — "Outbound, per space, HMAC-signed, with delivery retry and
 * a dead-letter view." RD-066 (payloads carry identifiers only), RD-067.
 */
export default async function WebhooksPage({ params }: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await params;
  const { can } = await requireSpace(spaceKey);
  if (!can('ADMIN')) return <PermissionRequired spaceKey={spaceKey} permission="ADMIN" what="Managing webhooks" />;

  const hooks = await listWebhooksUseCase(spaceKey);
  const deliveries = await Promise.all(hooks.map((hook) => listDeliveriesUseCase(spaceKey, hook.id, undefined, 20)));

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Webhooks</h1>
        <p className="text-sm text-[var(--rf-muted)]">
          Each event is POSTed as JSON carrying identifiers only — a record id such as <code>{spaceKey}/FN-001/current</code>,
          never a requirement&rsquo;s text — signed with <code>X-Reqforge-Signature: v1=HMAC-SHA256(secret, timestamp + &quot;.&quot; + body)</code>.
          A failed delivery is retried after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours, then lands in the dead
          letters below.
        </p>
      </div>
      <Panel>
        <CreateHookForm spaceKey={spaceKey} />
      </Panel>
      {hooks.map((hook, index) => (
        <Panel key={hook.id}>
          <div className="mb-2 flex flex-wrap items-center gap-3" data-testid="webhook">
            <code className="flex-1 break-all text-sm">{hook.url}</code>
            <span className="text-xs text-[var(--rf-muted)]">
              {hook.events.length > 0 ? hook.events.join(', ') : 'all events'} · {hook.delivered} delivered · {hook.pending} pending ·{' '}
              <span className={hook.dead > 0 ? 'text-red-700' : ''}>{hook.dead} dead</span>
            </span>
            <ActionForm action={deleteHookAction.bind(null, spaceKey)} submitLabel="Remove" danger>
              <input type="hidden" name="id" value={hook.id} />
            </ActionForm>
          </div>
          <table className="w-full text-xs" data-testid="webhook-deliveries">
            <tbody>
              {(deliveries[index] ?? []).map((delivery) => (
                <tr key={delivery.id} className="border-t border-[var(--rf-line)] align-top">
                  <td className="w-40 py-1">{delivery.createdAt.toISOString().slice(0, 19).replace('T', ' ')}</td>
                  <td className="w-44 py-1">{delivery.event.type}</td>
                  <td className="py-1 font-mono">{delivery.event.recordId ?? ''}</td>
                  <td className="w-24 py-1">{delivery.state.toLowerCase()}</td>
                  <td className="w-16 py-1">×{delivery.attempt}</td>
                  <td className="py-1 text-red-700">{delivery.lastError ?? ''}</td>
                  <td className="w-28 py-1">
                    {delivery.state === 'DEAD' ? (
                      <ActionForm action={redeliverAction.bind(null, spaceKey)} submitLabel="Redeliver">
                        <input type="hidden" name="id" value={delivery.id} />
                      </ActionForm>
                    ) : null}
                  </td>
                </tr>
              ))}
              {(deliveries[index] ?? []).length === 0 ? (
                <tr>
                  <td className="py-2 text-[var(--rf-muted)]">No deliveries yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Panel>
      ))}
    </main>
  );
}
