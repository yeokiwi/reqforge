/**
 * Query diagnostics. spec: 02-query-language.md §9 — every failure carries
 * `{ code, message, offset, length, hint }` so the editor can underline it.
 */
export type RqlErrorCode =
  | 'UNKNOWN_FIELD'
  | 'UNKNOWN_FUNCTION'
  | 'BAD_OPERATOR_FOR_FIELD'
  | 'TYPE_MISMATCH'
  | 'UNTERMINATED_STRING'
  | 'TRAVERSAL_TOO_DEEP'
  | 'AMBIGUOUS_PRECEDENCE'
  | 'CROSS_SPACE_NOT_ALLOWED'
  | 'SYNTAX_ERROR'
  | 'NOT_IMPLEMENTED';

export type RqlDiagnostic = {
  code: RqlErrorCode;
  message: string;
  offset: number;
  length: number;
  hint?: string;
  severity: 'error' | 'warning';
};

export function rqlError(
  code: RqlErrorCode,
  message: string,
  offset: number,
  length: number,
  hint?: string,
): RqlDiagnostic {
  return { code, message, offset, length, severity: 'error', ...(hint ? { hint } : {}) };
}

export function rqlWarning(
  code: RqlErrorCode,
  message: string,
  offset: number,
  length: number,
  hint?: string,
): RqlDiagnostic {
  return { code, message, offset, length, severity: 'warning', ...(hint ? { hint } : {}) };
}

/** Thrown by the lexer and parser; the analyser collects diagnostics instead. */
export class RqlSyntaxError extends Error {
  constructor(readonly diagnostic: RqlDiagnostic) {
    super(diagnostic.message);
    this.name = 'RqlSyntaxError';
  }
}

/** Levenshtein distance, for the did-you-mean in `UNKNOWN_FIELD`. */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const columns = b.length + 1;
  let previous = Array.from({ length: columns }, (_, index) => index);

  for (let row = 1; row < rows; row += 1) {
    const current = [row, ...Array.from({ length: columns - 1 }, () => 0)];
    for (let column = 1; column < columns; column += 1) {
      const substitution = (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1);
      const insertion = (current[column - 1] ?? 0) + 1;
      const deletion = (previous[column] ?? 0) + 1;
      current[column] = Math.min(substitution, insertion, deletion);
    }
    previous = current;
  }

  return previous[columns - 1] ?? Math.max(a.length, b.length);
}

export function nearestName(name: string, candidates: readonly string[]): string | null {
  const lower = name.toLowerCase();
  let best: { name: string; distance: number } | null = null;

  for (const candidate of candidates) {
    const distance = editDistance(lower, candidate.toLowerCase());
    if (best === null || distance < best.distance) best = { name: candidate, distance };
  }

  // Beyond a third of the name's length, a suggestion is noise rather than help.
  return best && best.distance <= Math.max(2, Math.floor(name.length / 3)) ? best.name : null;
}
