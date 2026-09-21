import { Panel } from '@/app/_components/chrome';
import { PermissionRequired } from '@/app/_components/permission-required';
import { ForbiddenError } from '@/domain/errors';
import { requireSpace } from '@/server/authz';
import { GridClient } from './grid-client';

export default async function DependenciesPage({ params }: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await params;

  // spec 04 §4.3 — the grid and coverage are gated on EXPORT, because the cost is here.
  let space;
  try {
    ({ space } = await requireSpace(spaceKey, 'EXPORT'));
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return <PermissionRequired spaceKey={spaceKey} permission="EXPORT" what="The dependency matrix" />;
    }
    throw error;
  }

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dependency matrix</h1>
        <p className="text-sm text-[var(--rf-muted)]">
          A requirement × requirement grid over one query, in space {space.key}. A cell shows the relationships
          linking the row to the column: the row is the child, the column its parent.
        </p>
      </div>

      <Panel>
        <GridClient spaceKey={space.key} />
      </Panel>
    </main>
  );
}
