import { normaliseScopes } from '@/domain/api-scopes';
import { ValidationError } from '@/domain/errors';
import { requireSessionUser } from '@/server/authz';
import { createApiToken, listApiTokens, revokeApiToken, type TokenView } from '@/server/repositories/api-tokens';
import { recordAuditEvent } from '@/server/repositories/audit';
import { listSpacesForUser } from '@/server/repositories/spaces';

/**
 * A person's own API tokens. spec: 08-api-surface.md §1; RD-065. Managed from a session
 * only, and audited: a token is a credential, and an auditor will ask who could act as whom.
 */

export async function listMyTokensUseCase(): Promise<TokenView[]> {
  const user = await requireSessionUser();
  return listApiTokens(user.id);
}

export async function createMyTokenUseCase(input: {
  name: unknown;
  scopes: readonly unknown[];
  spaceKeys: readonly unknown[];
}): Promise<{ token: string; view: TokenView }> {
  const user = await requireSessionUser();

  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim() : '';
  if (name.length < 1 || name.length > 80) throw new ValidationError('A token needs a name of 1–80 characters.');

  const scopes = normaliseScopes(input.scopes);
  if (scopes.length === 0) throw new ValidationError('Choose at least one scope.');

  // A token may be confined to spaces its owner can see; naming any other is a mistake
  // worth refusing rather than a silent no-op.
  const visible = new Set((await listSpacesForUser(user.id)).map((entry) => entry.space.key));
  const spaceKeys = [...new Set(input.spaceKeys.filter((key): key is string => typeof key === 'string' && key.length > 0))];
  const unknown = spaceKeys.filter((key) => !visible.has(key));
  if (unknown.length > 0) throw new ValidationError(`You cannot see ${unknown.join(', ')}.`);

  const created = await createApiToken({ userId: user.id, name, scopes, spaceKeys });
  await recordAuditEvent({
    actorId: user.id,
    spaceId: null,
    objectType: 'ApiToken',
    objectId: created.view.id,
    operation: 'create',
    parameters: { name, scopes, spaceKeys },
  });
  return created;
}

export async function revokeMyTokenUseCase(id: string): Promise<TokenView> {
  const user = await requireSessionUser();
  const view = await revokeApiToken(user.id, id);
  await recordAuditEvent({
    actorId: user.id,
    spaceId: null,
    objectType: 'ApiToken',
    objectId: id,
    operation: 'revoke',
    parameters: { name: view.name },
  });
  return view;
}
