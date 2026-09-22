import { Panel } from '@/app/_components/chrome';
import { PermissionRequired } from '@/app/_components/permission-required';
import { requireSpace } from '@/server/authz';
import { RenameClient } from './rename-client';

/**
 * spec: 03-authoring-and-indexing.md §5. `RD-053` — renaming needs `ADMIN`: Requirement
 * Yogi restricts it to a global administrator or an explicitly granted group
 * (research §2.8), and a key is a requirement's identity.
 */
export default async function RenamePage({
  params,
  searchParams,
}: {
  params: Promise<{ spaceKey: string }>;
  searchParams: Promise<{ keys?: string }>;
}) {
  const { spaceKey } = await params;
  const { keys } = await searchParams;
  const { space, can } = await requireSpace(spaceKey);

  if (!can('ADMIN')) {
    return <PermissionRequired spaceKey={space.key} permission="ADMIN" what="renaming requirements" />;
  }

  const selected = [...new Set((keys ?? '').split(',').map((key) => key.trim()).filter((key) => key.length > 0))];

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-4 text-xl font-semibold tracking-tight">Rename requirements</h1>
      <Panel>
        {selected.length === 0 ? (
          <p className="text-sm text-[var(--rf-muted)]">
            Select the requirements to rename on the search screen first.
          </p>
        ) : (
          <RenameClient spaceKey={space.key} keys={selected} />
        )}
      </Panel>
    </main>
  );
}
