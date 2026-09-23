import { parseAndAnalyse, type RqlDiagnostic } from '@/domain/ryql';
import { isPMNode, type PMNode } from '@/domain/doc';
import {
  modeOf,
  parseColumns,
  renderReportRows,
  resolveLastRequirement,
  type ReportColumn,
  type ReportConfig,
  type ReportProblem,
  type ReportRow,
  type ReportSource,
} from '@/domain/traceability/report';
import { requireSpace } from '@/server/authz';
import { findDocument } from '@/server/repositories/documents';
import { groupIdsOf, runSearch, visibilityPredicate } from '@/server/repositories/search';
import { loadExternalTypes } from '@/server/repositories/external-properties';
import { fetchReportData } from '@/server/repositories/traceability';

export type ReportSuccess = {
  ok: true;
  columns: ReportColumn[];
  rows: ReportRow[];
  total: number;
  countOnly: boolean;
  problems: ReportProblem[];
  /** The key a "last requirement" report resolved to, for the byline. */
  resolvedKey: string | null;
};

export type ReportFailure = { ok: false; errors: RqlDiagnostic[]; problems: ReportProblem[] };

export const REPORT_ROW_LIMIT = 100;

/**
 * Renders a report embedded in a document.
 * spec: 04-traceability-and-coverage.md §5 — either checkbox ignores the query and
 * resolves against the document instead (research §4.5, `RD-035`).
 */
export async function renderReportUseCase(input: {
  spaceKey: string;
  documentId: string;
  reportId: string;
  config: ReportConfig;
}): Promise<ReportSuccess | ReportFailure> {
  const { space, user, viewer } = await requireSpace(input.spaceKey);
  const { columns, problems } = parseColumns(input.config.columns);
  const mode = modeOf(input.config);

  let query = input.config.query.trim();
  let resolvedKey: string | null = null;

  if (mode !== 'query') {
    const document = await findDocument(viewer, space.id, input.documentId);
    const content = document?.currentVersion?.content;
    resolvedKey = isPMNode(content) ? resolveLastRequirement(content as PMNode, input.reportId, mode) : null;

    if (resolvedKey === null) {
      return {
        ok: true,
        columns,
        rows: [],
        total: 0,
        countOnly: input.config.countOnly,
        problems: [
          ...problems,
          {
            source: mode === 'lastDefinition' ? 'use the last requirement definition' : 'use the last requirement',
            message: 'There is no requirement before this report in the document.',
          },
        ],
        resolvedKey: null,
      };
    }

    // The query is ignored entirely in this mode (research §4.5).
    query = `key = '${resolvedKey.replace(/'/g, "\\'")}'`;
  }

  if (query.length === 0) {
    return {
      ok: false,
      problems,
      errors: [
        {
          code: 'SYNTAX_ERROR',
          severity: 'error',
          message: 'A report needs a query, or one of the "last requirement" options.',
          offset: 0,
          length: 0,
        },
      ],
    };
  }

  const externalTypes = await loadExternalTypes();
  const analysed = parseAndAnalyse(query, {
    spaceKey: space.key,
    isolated: space.isolated,
    defaultBaseline: null,
    externalTypes,
  });
  if (!analysed.ok) return { ok: false, errors: analysed.errors, problems };

  const visibility = visibilityPredicate(user.id, await groupIdsOf(user.id));
  const { rows, total } = await runSearch(analysed.query.expr, {
    visibility,
    externalTypes,
    knownSpaces: { [space.key]: space.id },
    // `countOnly` needs the total, which runSearch reports regardless of the page size.
    limit: input.config.countOnly ? 1 : REPORT_ROW_LIMIT,
    offset: 0,
  });

  if (input.config.countOnly) {
    return { ok: true, columns, rows: [], total, countOnly: true, problems, resolvedKey };
  }

  const data = await fetchReportData(
    rows.map((row) => row.id),
    visibility,
    viewer,
  );

  const sources: ReportSource[] = rows.map((row) => {
    const extra = data.get(row.id);
    return {
      key: row.key,
      title: row.title,
      bodyHtml: row.bodyHtml,
      status: row.status,
      properties: extra?.properties ?? [],
      documents: extra?.documents ?? [],
      dependencies: extra?.dependencies ?? [],
    };
  });

  return {
    ok: true,
    columns,
    rows: renderReportRows(columns, sources),
    total,
    countOnly: false,
    problems,
    resolvedKey,
  };
}
