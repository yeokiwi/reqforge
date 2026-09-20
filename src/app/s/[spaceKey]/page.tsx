import Link from 'next/link';
import { Panel } from '@/app/_components/chrome';
import { requireSpace } from '@/server/authz';
import { countDocuments, countRequirements } from '@/server/repositories/spaces';

export default async function SpaceOverviewPage({ params }: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await params;
  const { space, permissions } = await requireSpace(spaceKey);
  const [documents, requirements] = await Promise.all([
    countDocuments(space.id),
    countRequirements(space.id),
  ]);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{space.name}</h1>
        <p className="text-sm text-[var(--rf-muted)]">Your permissions: {permissions.join(', ')}</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Panel>
          <p className="text-3xl font-semibold">{documents}</p>
          <p className="text-sm text-[var(--rf-muted)]">documents</p>
          <Link href={`/s/${space.key}/documents`} className="mt-2 inline-block text-sm text-[var(--rf-accent)]">
            Open the document tree →
          </Link>
        </Panel>
        <Panel>
          <p className="text-3xl font-semibold">{requirements}</p>
          <p className="text-sm text-[var(--rf-muted)]">active requirements</p>
          <Link href={`/s/${space.key}/search`} className="mt-2 inline-block text-sm text-[var(--rf-accent)]">
            Search them →
          </Link>
        </Panel>
      </div>
    </main>
  );
}
