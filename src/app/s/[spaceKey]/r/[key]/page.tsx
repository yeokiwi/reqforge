import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Panel } from '@/app/_components/chrome';
import { requireSpace } from '@/server/authz';
import { baselinesContaining } from '@/server/repositories/baselines';
import { listHistory } from '@/server/repositories/history';
import { formerKeys, resolveKeyAlias } from '@/server/repositories/rename';
import { findRequirementDetail } from '@/server/repositories/requirements';
import { definitionsForSpace } from '@/server/usecases/external-properties';
import { DependencyPanel } from '../dependency-panel';
import { edgesOf } from '../edges';
import { ExternalValues, type ValueRow } from '../external-values';

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
  const { space, can, viewer } = await requireSpace(spaceKey);
  const asked = decodeURIComponent(key);
  // RD-064 — a hidden requirement is a 404, indistinguishable from one that never existed.
  const requirement = await findRequirementDetail(viewer, space.id, asked);

  if (!requirement) {
    // spec 03 §5 / RD-051 — a key this requirement used to have still resolves, so a link
    // written before a rename, and a key read off a frozen baseline, both still land.
    const renamed = await resolveKeyAlias(space.id, asked, viewer);
    if (renamed) redirect(`/s/${spaceKey}/r/${encodeURIComponent(renamed.currentKey)}?renamedFrom=${encodeURIComponent(renamed.formerKey)}`);
    notFound();
  }

  const origin = requirement.links.find((link) => link.origin);
  const citations = requirement.links.filter((link) => !link.origin);

  // Inline properties come out of the document; external ones get their own panel below,
  // because they are the only ones editable here (overview, decision 2).
  // spec 05 §4 — which numbered snapshots hold this key, newest first.
  const baselines = await baselinesContaining(viewer, space.id, requirement.upperKey);
  // spec 05 §6 — off by default per space, so the panel appears only where it is on.
  const history = space.historyEnabled
    ? await listHistory({ viewer, spaceId: space.id, requirementId: requirement.id, limit: 50 })
    : [];
  const former = await formerKeys(requirement.id);
  const inline = requirement.properties.filter((property) => property.kind === 'INLINE');
  const definitions = await definitionsForSpace(spaceKey);
  const externalRows: ValueRow[] = definitions.map((definition) => ({
    definition,
    value:
      requirement.properties.find(
        (property) => property.kind === 'EXTERNAL' && property.definitionId === definition.id,
      )?.value ?? '',
  }));

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-8">
      {former.length > 0 ? (
        <p className="text-xs text-[var(--rf-muted)]" data-testid="renamed-from">
          Previously {former.join(', ')}. A baseline frozen before the rename still shows the older key (RD-007).
        </p>
      ) : null}

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

      {baselines.length > 0 ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--rf-muted)]" data-testid="in-baselines">
          Frozen in:
          {baselines.map((baseline) => (
            <Link
              key={baseline.id}
              href={`/s/${spaceKey}/baselines/${baseline.number}`}
              className="rounded bg-sky-50 px-2 py-0.5 text-sky-700"
            >
              #{baseline.number} {baseline.name}
            </Link>
          ))}
        </p>
      ) : null}

      <Panel>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">Excerpt</h2>
        <div className="rf-prose" data-testid="requirement-body" dangerouslySetInnerHTML={{ __html: requirement.bodyHtml }} />
      </Panel>

      {inline.length > 0 ? (
        <Panel>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">Properties</h2>
          <dl className="grid grid-cols-[12rem_1fr] gap-x-4 gap-y-1 text-sm">
            {inline.map((property) => (
              <div key={property.id} className="contents">
                <dt className="text-[var(--rf-muted)]">{property.name}</dt>
                <dd>{property.value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      ) : null}

      <Panel>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">
          External properties
        </h2>
        <ExternalValues
          spaceKey={spaceKey}
          requirementId={requirement.id}
          rows={externalRows}
          canEdit={can('EDIT')}
        />
      </Panel>

      <Panel>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">Dependencies</h2>
        <DependencyPanel
          spaceKey={spaceKey}
          requirementKey={requirement.key}
          edges={edgesOf(requirement, space.key)}
        />
      </Panel>

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

      {history.length > 0 ? (
        <Panel>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">History</h2>
          <table className="w-full text-sm" data-testid="requirement-history">
            <tbody>
              {history.map((entry) => (
                <tr key={entry.id} className="border-t border-[var(--rf-line)] align-top">
                  <td className="w-44 py-1.5 text-xs text-[var(--rf-muted)]">{entry.at.toISOString()}</td>
                  <td className="w-40 py-1.5 text-xs">{entry.changeKind}</td>
                  <td className="py-1.5 text-xs text-[var(--rf-muted)]">{entry.actorId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ) : null}

      <p className="text-xs text-[var(--rf-muted)]">
        Record id: {space.key}/{requirement.key}/current
      </p>
    </main>
  );
}
