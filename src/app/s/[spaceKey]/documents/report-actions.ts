'use server';

import { isAppError } from '@/domain/errors';
import type { ReportConfig } from '@/domain/traceability/report';
import type { RenderedReport } from '@/editor/report-view';
import { renderReportUseCase } from '@/server/usecases/report';

/** Renders an embedded report with live rows (spec 04 §5). */
export async function renderReportAction(
  spaceKey: string,
  documentId: string,
  reportId: string,
  config: ReportConfig,
): Promise<RenderedReport> {
  const empty = {
    columns: [],
    rows: [],
    total: 0,
    countOnly: false,
    problems: [],
    resolvedKey: null,
  };

  try {
    const result = await renderReportUseCase({ spaceKey, documentId, reportId, config });

    if (!result.ok) {
      return {
        ...empty,
        ok: false,
        problems: result.problems,
        errors: result.errors.map((error) => ({
          message: error.message,
          ...(error.hint ? { hint: error.hint } : {}),
        })),
      };
    }

    return {
      ok: true,
      columns: result.columns,
      rows: result.rows,
      total: result.total,
      countOnly: result.countOnly,
      problems: result.problems,
      resolvedKey: result.resolvedKey,
      errors: [],
    };
  } catch (error) {
    if (isAppError(error)) return { ...empty, ok: false, errors: [{ message: error.message }] };
    throw error;
  }
}
