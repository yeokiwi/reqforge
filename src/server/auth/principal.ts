import { AsyncLocalStorage } from 'node:async_hooks';
import type { User } from '@prisma/client';
import type { ApiScope } from '@/domain/api-scopes';

/**
 * Who is calling, for the duration of one API request. spec: 08-api-surface.md §1 —
 * "Every endpoint enforces the same permission and visibility rules as the UI … There is
 * no privileged API path."
 *
 * The API authenticates once (bearer token or session cookie) and runs its handler inside
 * `runWithPrincipal`. `currentUser()` and `requireSpace()` consult the principal before
 * anything else, so every existing use case runs under a token unchanged: the only thing a
 * token changes is which permissions `requireSpace` reports (RD-065).
 */
export type Principal =
  | { kind: 'session'; user: User }
  | { kind: 'token'; user: User; tokenId: string; scopes: readonly ApiScope[]; spaceKeys: readonly string[] };

const storage = new AsyncLocalStorage<Principal>();

export function runWithPrincipal<T>(principal: Principal, work: () => Promise<T>): Promise<T> {
  return storage.run(principal, work);
}

export function currentPrincipal(): Principal | undefined {
  return storage.getStore();
}
