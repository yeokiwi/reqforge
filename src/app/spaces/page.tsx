import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TopBar, Panel } from '@/app/_components/chrome';
import { currentUser } from '@/server/auth/session';
import { listSpacesForUser } from '@/server/repositories/spaces';

export default async function SpacesPage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const spaces = await listSpacesForUser(user.id);

  return (
    <>
      <TopBar userName={user.name} />
      <main className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-8">
        <h1 className="text-xl font-semibold tracking-tight">Spaces</h1>
        {spaces.length === 0 ? (
          <Panel>
            <p className="text-sm text-[var(--rf-muted)]">
              You are not a member of any space yet. Ask a space administrator for access.
            </p>
          </Panel>
        ) : (
          <ul className="flex flex-col gap-3">
            {spaces.map(({ space, permissions }) => (
              <li key={space.id}>
                <Link href={`/s/${space.key}`} className="block">
                  <Panel className="transition hover:border-[var(--rf-accent)]">
                    <div className="flex items-baseline gap-3">
                      <span className="rounded bg-[var(--rf-bg)] px-2 py-0.5 font-mono text-xs">{space.key}</span>
                      <span className="font-medium">{space.name}</span>
                      {space.isolated ? (
                        <span className="text-xs text-[var(--rf-muted)]">isolated</span>
                      ) : null}
                      {space.classification ? (
                        <span className="text-xs text-amber-700">{space.classification}</span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-[var(--rf-muted)]">{permissions.join(' · ')}</p>
                  </Panel>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
