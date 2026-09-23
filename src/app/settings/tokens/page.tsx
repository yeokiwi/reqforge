import { redirect } from 'next/navigation';
import { ActionForm } from '@/app/_components/action-form';
import { Panel, TopBar } from '@/app/_components/chrome';
import { AuthenticationError } from '@/domain/errors';
import { requireUser } from '@/server/authz';
import { listMyTokensUseCase } from '@/server/usecases/api-tokens';
import { revokeTokenAction } from './actions';
import { CreateTokenForm } from './create-token-form';

/**
 * A person's API tokens. spec: 08-api-surface.md §1 — "API tokens (scoped, per user,
 * revocable) for machines. Bearer header." RD-065.
 */
export default async function TokensPage() {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError) redirect('/login');
    throw error;
  }
  const tokens = await listMyTokensUseCase();

  return (
    <>
      <TopBar userName={user.name} />
      <main className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">API tokens</h1>
          <p className="text-sm text-[var(--rf-muted)]">
            Send a token as <code>Authorization: Bearer rf_…</code> to <code>/api/v1</code>. A token can never do more than you
            can: its rights in a space are its scopes <em>and</em> your own permissions there, so when you lose access, so does
            it. The API is described at <a className="text-[var(--rf-accent)]" href="/api/v1/openapi.json">/api/v1/openapi.json</a>.
          </p>
        </div>
        <Panel>
          <CreateTokenForm />
        </Panel>
        <Panel>
          <table className="w-full text-sm" data-testid="token-list">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--rf-muted)]">
                <th className="pb-2">Name</th>
                <th className="pb-2">Scopes</th>
                <th className="pb-2">Spaces</th>
                <th className="pb-2">Last used</th>
                <th className="w-40 pb-2" />
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <tr key={token.id} className="border-t border-[var(--rf-line)]">
                  <td className="py-1.5">{token.name}</td>
                  <td className="py-1.5 text-xs">{token.scopes.join(', ')}</td>
                  <td className="py-1.5 text-xs">{token.spaceKeys.length > 0 ? token.spaceKeys.join(', ') : 'all'}</td>
                  <td className="py-1.5 text-xs text-[var(--rf-muted)]">{token.lastUsed?.toISOString().slice(0, 16).replace('T', ' ') ?? 'never'}</td>
                  <td className="py-1.5">
                    {token.revokedAt ? (
                      <span className="text-xs text-[var(--rf-muted)]">revoked</span>
                    ) : (
                      <ActionForm action={revokeTokenAction} submitLabel="Revoke" danger>
                        <input type="hidden" name="id" value={token.id} />
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
              {tokens.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-3 text-[var(--rf-muted)]">
                    No tokens yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Panel>
      </main>
    </>
  );
}
