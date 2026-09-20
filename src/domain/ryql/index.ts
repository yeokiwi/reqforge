import { analyse, type AnalyserContext, type AnalysedQuery } from './analyser';
import { RqlSyntaxError, type RqlDiagnostic } from './errors';
import { parse } from './parser';

export * from './ast';
export * from './errors';
export * from './fields';
export { tokenise } from './lexer';
export { parse } from './parser';
export { analyse } from './analyser';
export { printExpr } from './print';
export type { AnalyserContext, AnalysedQuery } from './analyser';

export type QueryResult =
  | { ok: true; query: AnalysedQuery; warnings: RqlDiagnostic[] }
  | { ok: false; errors: RqlDiagnostic[] };

/**
 * The front end of the query pipeline: source → lexer → parser → AST → analyser.
 * spec: 02-query-language.md §1 — pure, with no database imports.
 */
export function parseAndAnalyse(source: string, context: AnalyserContext): QueryResult {
  let parsed;
  try {
    parsed = parse(source);
  } catch (error) {
    if (error instanceof RqlSyntaxError) return { ok: false, errors: [error.diagnostic] };
    throw error;
  }

  const query = analyse(parsed, context);
  const errors = query.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, query, warnings: query.diagnostics };
}
