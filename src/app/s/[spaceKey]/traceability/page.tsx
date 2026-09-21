import { Panel } from '@/app/_components/chrome';
import { parseMatrixColumns } from '@/domain/traceability/matrix';
import { requireSpace } from '@/server/authz';
import { listMatricesUseCase } from '@/server/usecases/matrix';
import { MatrixClient } from './matrix-client';

export default async function TraceabilityPage({ params }: { params: Promise<{ spaceKey: string }> }) {
  const { spaceKey } = await params;
  const { space, can } = await requireSpace(spaceKey);
  const saved = await listMatricesUseCase(spaceKey);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Traceability matrix</h1>
        <p className="text-sm text-[var(--rf-muted)]">
          One row per requirement, driven by a query, with the columns you choose. The requirement × requirement
          grid is the dependency matrix, which is a different screen.
        </p>
      </div>

      <Panel>
        <MatrixClient
          spaceKey={space.key}
          canEdit={can('EDIT')}
          canExport={can('EXPORT')}
          saved={saved.map((matrix) => ({
            id: matrix.id,
            name: matrix.name,
            query: matrix.query,
            columns: parseMatrixColumns(matrix.columns),
            visibility: matrix.visibility,
          }))}
        />
      </Panel>
    </main>
  );
}
