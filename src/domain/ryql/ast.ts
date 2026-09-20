/** spec: 02-query-language.md §3 — the grammar this AST mirrors. */
export type Span = { offset: number; length: number };

export type ComparisonOperator = '=' | '!=' | '~' | 'NOT LIKE' | '<' | '<=' | '>' | '>=';

export type FieldRef = Span & {
  /** Lower-cased field name; `property` for a bare `@Name`. */
  name: string;
  /** Text after `@`, verbatim. */
  qualifier: string | null;
};

export type Value =
  | (Span & { kind: 'string'; value: string })
  | (Span & { kind: 'number'; value: number })
  | (Span & { kind: 'variable'; name: string })
  | (Span & { kind: 'call'; name: string; args: Value[] });

export type Expr =
  | (Span & { kind: 'and'; left: Expr; right: Expr })
  | (Span & { kind: 'or'; left: Expr; right: Expr })
  | (Span & { kind: 'not'; expr: Expr })
  | (Span & { kind: 'group'; expr: Expr })
  | (Span & { kind: 'comparison'; field: FieldRef; operator: ComparisonOperator; value: Value; synthetic?: boolean })
  | (Span & { kind: 'nullTest'; field: FieldRef; negated: boolean; synthetic?: boolean })
  | (Span & { kind: 'inTest'; field: FieldRef; values: Value[]; negated: boolean })
  | (Span & { kind: 'traversal'; field: FieldRef; expr: Expr })
  | (Span & { kind: 'call'; name: string; args: Value[] })
  | (Span & { kind: 'baselineWas'; value: Value });

export const SYNTHETIC: Span = { offset: 0, length: 0 };

/** Depth-first walk over every sub-expression, parents before children. */
export function* walkExpr(expr: Expr): Generator<Expr> {
  yield expr;
  switch (expr.kind) {
    case 'and':
    case 'or':
      yield* walkExpr(expr.left);
      yield* walkExpr(expr.right);
      break;
    case 'not':
    case 'group':
    case 'traversal':
      yield* walkExpr(expr.expr);
      break;
    default:
      break;
  }
}

/** Every field reference in the tree, including inside traversals. */
export function fieldRefs(expr: Expr): FieldRef[] {
  const refs: FieldRef[] = [];
  for (const node of walkExpr(expr)) {
    if ('field' in node && node.field) refs.push(node.field);
  }
  return refs;
}

/** True when the tree mentions this field outside a traversal's right-hand side. */
export function mentionsField(expr: Expr, name: string): boolean {
  switch (expr.kind) {
    case 'and':
    case 'or':
      return mentionsField(expr.left, name) || mentionsField(expr.right, name);
    case 'not':
    case 'group':
      return mentionsField(expr.expr, name);
    case 'traversal':
      return expr.field.name === name;
    case 'baselineWas':
      return name === 'baseline';
    case 'comparison':
    case 'nullTest':
    case 'inTest':
      return expr.field.name === name;
    default:
      return false;
  }
}

export function and(left: Expr, right: Expr): Expr {
  return { kind: 'and', left, right, offset: left.offset, length: right.offset + right.length - left.offset };
}
