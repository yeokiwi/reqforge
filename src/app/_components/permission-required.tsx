import Link from 'next/link';
import { Panel } from './chrome';

/**
 * An expected refusal, rendered as a screen rather than thrown through the error
 * boundary — a production build redacts thrown messages, and "you need this permission"
 * is exactly the message a reader needs to see.
 * spec: 07-permissions-and-limits.md §2.1
 */
export function PermissionRequired({
  spaceKey,
  permission,
  what,
}: {
  spaceKey: string;
  permission: string;
  what: string;
}) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-12">
      <Panel>
        <h1 className="text-lg font-semibold tracking-tight">{what} needs the {permission} permission</h1>
        <p className="mt-2 text-sm text-[var(--rf-muted)]">
          You can see this space, but {what.toLowerCase()} is gated on {permission} because it is one of the
          expensive screens. Ask a space administrator for it.
        </p>
        <Link href={`/s/${spaceKey}`} className="mt-3 inline-block text-sm text-[var(--rf-accent)]">
          Back to {spaceKey}
        </Link>
      </Panel>
    </main>
  );
}
