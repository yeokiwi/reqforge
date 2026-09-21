'use server';

import { isAppError } from '@/domain/errors';
import type { EmbeddedMatrix } from '@/editor/saved-matrix-view';
import { loadSavedMatrixUseCase, runMatrixUseCase } from '@/server/usecases/matrix';

/**
 * Renders an embedded saved matrix with live data, scoped to the document it sits in so
 * `$currentBaseline` resolves there (spec 04 §2.3, RD-031).
 */
export async function renderEmbeddedMatrixAction(
  spaceKey: string,
  documentId: string,
  matrixId: string,
): Promise<EmbeddedMatrix | { error: string }> {
  try {
    const saved = await loadSavedMatrixUseCase(spaceKey, matrixId);
    if (!saved) return { error: 'That saved matrix no longer exists.' };

    const result = await runMatrixUseCase({
      spaceKey,
      config: saved.config,
      offset: 0,
      documentId,
    });
    if (!result.ok) return { error: result.errors[0]?.message ?? 'That matrix query is not valid.' };

    return {
      name: saved.name,
      columns: result.page.config.columns,
      rows: result.page.rows,
      total: result.page.total,
    };
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }
}
