import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NotFoundError } from '@/domain/errors';
import { Panel } from '@/app/_components/chrome';
import { renderHtml, type PMNode } from '@/domain/doc';
import { documentHistory, documentVersion } from '@/server/usecases/documents';

export default async function DocumentHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ spaceKey: string; docId: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { spaceKey, docId } = await params;
  const { version: requested } = await searchParams;
  let loaded;
  try {
    loaded = await documentHistory(spaceKey, docId);
  } catch (error) {
    // RD-064 — the versions of a hidden document are as absent as the document.
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { document, versions } = loaded;

  const selectedNumber = requested ? Number.parseInt(requested, 10) : versions[0]?.number;
  const selected =
    selectedNumber && Number.isFinite(selectedNumber)
      ? (await documentVersion(spaceKey, docId, selectedNumber)).version
      : null;

  return (
    <main className="mx-auto flex max-w-5xl gap-6 px-6 py-8">
      <aside className="w-64 shrink-0">
        <h1 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--rf-muted)]">
          {document.title} — history
        </h1>
        <ul className="flex flex-col gap-1">
          {versions.map((version) => (
            <li key={version.id}>
              <Link
                href={`/s/${spaceKey}/documents/${docId}/history?version=${version.number}`}
                className={`block rounded px-2 py-1 text-sm ${
                  version.number === selected?.number ? 'bg-[var(--rf-accent)] text-white' : 'hover:bg-[var(--rf-bg)]'
                }`}
              >
                Version {version.number}
                <span className="block text-xs opacity-70">
                  {version.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                  {version.message ? ` · ${version.message}` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Link href={`/s/${spaceKey}/documents/${docId}`} className="mt-4 inline-block text-sm text-[var(--rf-accent)]">
          ← Back to the document
        </Link>
      </aside>

      <section className="flex-1">
        <Panel>
          {selected ? (
            <>
              <p className="mb-3 text-xs text-[var(--rf-muted)]">
                Version {selected.number} — read-only. Versions are immutable.
              </p>
              <div
                className="rf-prose"
                data-testid="version-body"
                dangerouslySetInnerHTML={{ __html: renderHtml(selected.content as PMNode) }}
              />
            </>
          ) : (
            <p className="text-sm text-[var(--rf-muted)]">This document has no versions yet.</p>
          )}
        </Panel>
      </section>
    </main>
  );
}
