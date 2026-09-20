import { Panel } from '@/app/_components/chrome';
import { requireSpace } from '@/server/authz';
import { listSavedSearchesUseCase } from '@/server/usecases/search';
import { SavedSearches } from './saved-searches';
import { SearchClient } from './search-client';

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ spaceKey: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { spaceKey } = await params;
  const { q } = await searchParams;
  const { space, can } = await requireSpace(spaceKey);
  const searches = await listSavedSearchesUseCase(spaceKey);

  return (
    <main className="mx-auto flex max-w-6xl gap-6 px-6 py-8">
      <section className="flex-1">
        <h1 className="mb-4 text-xl font-semibold tracking-tight">Search</h1>
        <Panel>
          <SearchClient spaceKey={space.key} initialQuery={q ?? ''} isolated={space.isolated} />
        </Panel>
      </section>

      <aside className="w-72 shrink-0">
        <Panel>
          <SavedSearches
            spaceKey={space.key}
            canEdit={can('EDIT')}
            searches={searches.map((search) => ({
              id: search.id,
              name: search.name,
              query: search.query,
              visibility: search.visibility,
            }))}
          />
        </Panel>
      </aside>
    </main>
  );
}
