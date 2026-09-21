'use server';

import { isAppError } from '@/domain/errors';
import { runDependencyMatrixUseCase, type GridResult } from '@/server/usecases/dependency-matrix';
import { exportDependencyMatrixUseCase } from '@/server/usecases/jobs';
import type { JobView } from '../traceability/actions';

export type GridResponse =
  | { ok: true; axis: Array<{ key: string; title: string }>; cells: Array<[string, string[]]>; legend: Array<{ initials: string; relationship: string }>; population: number }
  | { ok: false; refusal: { reason: string; message: string; population: number } }
  | { ok: false; errors: Array<{ code: string; message: string; offset: number; length: number; severity: string; hint?: string }> };

/** The grid, flattened for the wire: a Map does not survive a server action. */
export async function runDependencyMatrixAction(spaceKey: string, query: string): Promise<GridResponse> {
  const result: GridResult = await runDependencyMatrixUseCase({ spaceKey, query });

  if (result.ok) {
    return {
      ok: true,
      axis: result.grid.axis,
      cells: [...result.grid.cells.entries()],
      legend: result.grid.legend,
      population: result.population,
    };
  }

  if ('refusal' in result) {
    return {
      ok: false,
      refusal: {
        reason: result.refusal.reason,
        message: result.refusal.message,
        population: result.refusal.population,
      },
    };
  }

  return { ok: false, errors: result.errors };
}

export async function exportDependencyMatrixAction(
  spaceKey: string,
  query: string,
): Promise<JobView | { error: string }> {
  try {
    const job = await exportDependencyMatrixUseCase({ spaceKey, query });
    return {
      id: job.id,
      state: job.state,
      progress: job.progress,
      message: job.message,
      error: job.error,
      downloadHref: job.state === 'DONE' && job.resultRef ? `/s/${spaceKey}/jobs/${job.id}/download` : null,
    };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}
