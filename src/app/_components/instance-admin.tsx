import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { User } from '@prisma/client';
import { AuthenticationError, ForbiddenError } from '@/domain/errors';
import { requireInstanceAdmin } from '@/server/authz';
import { Panel, TopBar } from './chrome';

/**
 * The gate for instance-wide screens (groups, classification levels, external properties).
 * Returns the user, or the page to render instead: a refusal is rendered rather than
 * thrown, because a production build redacts a thrown message (RD-036).
 */
export async function instanceAdminOrRefusal(what: string): Promise<{ user: User } | { refusal: React.ReactElement }> {
  try {
    return { user: await requireInstanceAdmin(what) };
  } catch (error) {
    if (error instanceof AuthenticationError) redirect('/login');
    if (error instanceof ForbiddenError) {
      return {
        refusal: (
          <>
            <TopBar userName="" />
            <main className="mx-auto max-w-3xl px-6 py-12">
              <Panel>
                <h1 className="text-lg font-semibold tracking-tight">Instance administrators only</h1>
                <p className="mt-2 text-sm text-[var(--rf-muted)]">{error.message}</p>
                <Link href="/spaces" className="mt-3 inline-block text-sm text-[var(--rf-accent)]">
                  Back to your spaces
                </Link>
              </Panel>
            </main>
          </>
        ),
      };
    }
    throw error;
  }
}
