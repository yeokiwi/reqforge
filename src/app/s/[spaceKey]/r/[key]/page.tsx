import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Panel } from '@/app/_components/chrome';
import { requireSpace } from '@/server/authz';
import { findRequirementDetail } from '@/server/repositories/requirements';

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  DELETED: 'bg-red-50 text-red-700',
  ARCHIVED: 'bg-amber-50 text-amber-700',
  MOVED: 'bg-sky-50 text-sky-700',
};

export default async function RequirementPage({
  params,
}: {
  params: Promise<{ spaceKey: string; key: string }>;
}) {
  const { spaceKey, key } = await params;
  const { space } = await requireSpace(spaceKey);
  const requirement = await findRequirementDetail(space.id, decodeURIComponent(key));
  if (!requirement) notFound();

  const origin = requirement.links.find((link) => link.origin);
  const citations = requirement.links.filter((link) => !link.origin);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rf-req">{requirement.key}</span>
        <h1 className="flex-1 text-xl font-semibold tracking-tight">{requirement.title}</h1>
        <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLES[requirement.status] ?? 'bg-[var(--rf-bg)]'}`}>
          {requirement.status}
        </span>
        {requirement.type ? (
          <span className="rounded px-2 py-0.5 text-xs" style={{ background: `${requirement.type.colour}1a`, color: requirement.type.colour }}>
            {requirement.type.name ?? requirement.type.keyPattern}
          </span>
        ) : null}
      </div>

      <Panel>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">Excerpt</h2>
        <div className="rf-prose" data-testid="requirement-body" dangerouslySetInnerHTML={{ __html: requirement.bodyHtml }} />
      </Panel>

      {requirement.properties.length > 0 ? (
        <Panel>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">Properties</h2>
          <dl className="grid grid-cols-[12rem_1fr] gap-x-4 gap-y-1 text-sm">
            {requirement.properties.map((property) => (
              <div key={property.id} className="contents">
                <dt className="text-[var(--rf-muted)]">
                  {property.name}
                  {property.kind === 'EXTERNAL' ? '*' : ''}
                </dt>
                <dd>{property.value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      ) : null}

      <Panel>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">Occurrences</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {origin ? (
            <li>
              <Link href={`/s/${spaceKey}/documents/${origin.version.documentId}`} className="text-[var(--rf-accent)]">
                {origin.version.document.title}
              </Link>{' '}
              <span className="text-xs text-[var(--rf-muted)]">
                — defining occurrence, version {origin.version.number}
              </span>
            </li>
          ) : (
            <li className="text-[var(--rf-muted)]">No defining document. This requirement was removed from its document.</li>
          )}
          {citations.map((citation) => (
            <li key={citation.id}>
              <Link href={`/s/${spaceKey}/documents/${citation.version.documentId}`} className="text-[var(--rf-accent)]">
                {citation.version.document.title}
              </Link>{' '}
              <span className="text-xs text-[var(--rf-muted)]">— citation</span>
            </li>
          ))}
        </ul>
      </Panel>

      <p className="text-xs text-[var(--rf-muted)]">
        Record id: {space.key}/{requirement.key}/current
      </p>
    </main>
  );
}
