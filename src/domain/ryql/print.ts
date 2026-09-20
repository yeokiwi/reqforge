import type { Expr, Value } from './ast';

function printValue(value: Value): string {
  switch (value.kind) {
    case 'string':
      return `'${value.value.replace(/'/g, "\\'")}'`;
    case 'number':
      return String(value.value);
    case 'variable':
      return value.name;
    case 'call':
      return `${value.name}(${value.args.map(printValue).join(', ')})`;
  }
}

function printField(field: { name: string; qualifier: string | null }): string {
  if (!field.qualifier) return field.name;
  // Generated links always emit the quoted form (spec 02 §2.3, RD-011).
  const qualified = /\s/.test(field.qualifier) ? `'${field.qualifier}'` : field.qualifier;
  return field.name === 'property' ? `@${qualified}` : `${field.name}@${qualified}`;
}

/**
 * Renders a parsed query with every implied parenthesis shown.
 * spec: 02-query-language.md §3.1 — "the search UI renders the parse as the user typed it
 * with implied parentheses shown", which is also how the precedence corpus asserts trees.
 */
export function printExpr(expr: Expr): string {
  switch (expr.kind) {
    case 'and':
      return `(${printExpr(expr.left)} AND ${printExpr(expr.right)})`;
    case 'or':
      return `(${printExpr(expr.left)} OR ${printExpr(expr.right)})`;
    case 'not':
      return `NOT ${printExpr(expr.expr)}`;
    case 'group':
      return printExpr(expr.expr);
    case 'comparison':
      return `${printField(expr.field)} ${expr.operator} ${printValue(expr.value)}`;
    case 'nullTest':
      return `${printField(expr.field)} IS ${expr.negated ? 'NOT ' : ''}NULL`;
    case 'inTest':
      return `${printField(expr.field)} ${expr.negated ? 'NOT ' : ''}IN (${expr.values.map(printValue).join(', ')})`;
    case 'traversal':
      return `${printField(expr.field)} -> ${printExpr(expr.expr)}`;
    case 'call':
      return `${expr.name}(${expr.args.map(printValue).join(', ')})`;
    case 'baselineWas':
      return `baseline was ${printValue(expr.value)}`;
  }
}
