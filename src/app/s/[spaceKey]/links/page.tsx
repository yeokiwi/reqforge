import Link from 'next/link';
import { Panel } from '@/app/_components/chrome';
import { requireSpace } from '@/server/authz';
import { listBrokenLinks } from '@/server/repositories/requirements';

/**
 * The Broken links / Conflicts screen.
 * spec: 03-authoring-and-indexing.md rule S3 and §7; 01-domain-model.md invariant P2 —
 * "surfaced on the Broken Links screen. Never cascade-delete a dependency because its
 * target vanished."
 */
export default async function BrokenLinksPage({ params }: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await params;
  const { space, viewer } = await requireSpace(spaceKey);
  const { unresolved, conflicts, toDeleted } = await listBrokenLinks(viewer, space.id);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Broken links</h1>
        <p className="text-sm text-[var(--rf-muted)]">
          Links that do not resolve, and keys defined in more than one document. Nothing here is deleted
          automatically — the edge is kept so it resolves again when the target appears.
        </p>
      </div>

      <Panel>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">
          Unresolved dependencies ({unresolved.length})
        </h2>
        {unresolved.length === 0 ? (
          <p className="text-sm text-[var(--rf-muted)]">None.</p>
        ) : (
          <table className="w-full text-sm" data-testid="unresolved-dependencies">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--rf-muted)]">
                <th className="pb-2">Missing target</th>
                <th className="pb-2">Relationship</th>
                <th className="pb-2">Declared by</th>
                <th className="pb-2">Document</th>
              </tr>
            </thead>
            <tbody>
              {unresolved.map((row) => (
                <tr key={row.id} className="border-t border-[var(--rf-line)]">
                  <td className="py-1.5 font-mono text-xs text-red-600">
                    {row.targetSpaceKey === space.key ? '' : `${row.targetSpaceKey}/`}
                    {row.targetKey}
                  </td>
                  <td className="py-1.5">{row.relationship}</td>
                  <td className="py-1.5">
                    <Link href={`/s/${spaceKey}/r/${encodeURIComponent(row.child.key)}`} className="rf-req">
                      {row.child.key}
                    </Link>
                  </td>
                  <td className="py-1.5 text-xs text-[var(--rf-muted)]">
                    {row.child.originVersion?.document ? (
                      <Link href={`/s/${spaceKey}/documents/${row.child.originVersion.document.id}`}>
                        {row.child.originVersion.document.title}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">
          Dependencies on requirements that are no longer active ({toDeleted.length})
        </h2>
        {toDeleted.length === 0 ? (
          <p className="text-sm text-[var(--rf-muted)]">None.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm" data-testid="dangling-dependencies">
            {toDeleted.map((edge) => (
              <li key={`${edge.relationship}-${edge.parentId}-${edge.childId}`}>
                <Link href={`/s/${spaceKey}/r/${encodeURIComponent(edge.child.key)}`} className="rf-req">
                  {edge.child.key}
                </Link>{' '}
                <span className="text-[var(--rf-muted)]">{edge.relationship} →</span>{' '}
                <Link href={`/s/${spaceKey}/r/${encodeURIComponent(edge.parent.key)}`} className="rf-req-link">
                  {edge.parent.key}
                </Link>{' '}
                <span className="text-xs text-amber-700">{edge.parent.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--rf-muted)]">
          Key conflicts ({conflicts.length})
        </h2>
        {conflicts.length === 0 ? (
          <p className="text-sm text-[var(--rf-muted)]">None.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm" data-testid="key-conflicts">
            {conflicts.map((conflict) => (
              <li key={conflict.id}>
                <span className="font-mono text-xs text-red-600">{conflict.key}</span> — defined in{' '}
                <Link href={`/s/${spaceKey}/documents/${conflict.document.id}`} className="text-[var(--rf-accent)]">
                  {conflict.document.title}
                </Link>
                {conflict.relatedDocument ? (
                  <>
                    {' '}
                    and{' '}
                    {conflict.relatedDocument.id ? (
                      <Link
                        href={`/s/${spaceKey}/documents/${conflict.relatedDocument.id}`}
                        className="text-[var(--rf-accent)]"
                      >
                        {conflict.relatedDocument.title}
                      </Link>
                    ) : (
                      // Rule X2 — the conflict is real, but the other document is not named.
                      <span className="text-[var(--rf-muted)]">{conflict.relatedDocument.title}</span>
                    )}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </main>
  );
}
