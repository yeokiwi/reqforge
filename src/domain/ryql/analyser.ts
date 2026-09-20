import { and, mentionsField, SYNTHETIC, type Expr, type FieldRef, type Value } from './ast';
import { nearestName, rqlError, rqlWarning, type RqlDiagnostic } from './errors';
import {
  findField,
  KNOWN_FIELD_NAMES,
  MAX_TRAVERSAL_DEPTH,
  NOT_IMPLEMENTED_FIELDS,
  PREDICATE_FUNCTIONS,
  VALUE_FUNCTIONS,
  type FieldSpec,
} from './fields';

export type AnalyserContext = {
  /** The space the search runs in. */
  spaceKey: string;
  /** spec: 07 §3 — an isolated space refuses cross-space search. */
  isolated: boolean;
  /** The "cross space" toggle: true removes the default space scope (spec 02 §8 rule 1). */
  crossSpace?: boolean;
  /** The UI's baseline dropdown; an explicit `baseline` in the query overrides it. */
  defaultBaseline?: number | string | null;
};

export type AnalysedQuery = {
  /** The user's expression with the default scope injected — visible in the AST (spec 02 §8). */
  expr: Expr;
  /** The expression as written, before injection. */
  userExpr: Expr;
  diagnostics: RqlDiagnostic[];
  injected: string[];
};

/**
 * Validates a parsed query and applies the default scope.
 * spec: 02-query-language.md §4 (fields), §5 (operators), §8 (default scope), §9 (errors)
 */
export function analyse(expr: Expr, context: AnalyserContext): AnalysedQuery {
  const diagnostics: RqlDiagnostic[] = [];

  checkExpr(expr, diagnostics, 0);
  warnOnMixedPrecedence(expr, diagnostics);

  const { scoped, injected } = applyDefaultScope(expr, context, diagnostics);

  return { expr: scoped, userExpr: expr, diagnostics, injected };
}

function checkExpr(expr: Expr, diagnostics: RqlDiagnostic[], traversalDepth: number): void {
  switch (expr.kind) {
    case 'and':
    case 'or':
      checkExpr(expr.left, diagnostics, traversalDepth);
      checkExpr(expr.right, diagnostics, traversalDepth);
      return;

    case 'not':
    case 'group':
      checkExpr(expr.expr, diagnostics, traversalDepth);
      return;

    case 'traversal': {
      const field = resolveField(expr.field, diagnostics);
      if (field && !field.supportsTraversal) {
        diagnostics.push(
          rqlError(
            'BAD_OPERATOR_FOR_FIELD',
            `-> can only follow a dependency field (to, from, parent, child), not ${expr.field.name}.`,
            expr.field.offset,
            expr.field.length,
          ),
        );
      }

      const depth = traversalDepth + 1;
      if (depth > MAX_TRAVERSAL_DEPTH) {
        diagnostics.push(
          rqlError(
            'TRAVERSAL_TOO_DEEP',
            `A traversal chain may be at most ${MAX_TRAVERSAL_DEPTH} hops deep (RD-021).`,
            expr.offset,
            expr.length,
            'Split the query, or start from the other end of the dependency graph.',
          ),
        );
        return;
      }
      checkExpr(expr.expr, diagnostics, depth);
      return;
    }

    case 'comparison': {
      const field = resolveField(expr.field, diagnostics);
      if (!field) return;
      if (!field.operators.includes(expr.operator)) {
        diagnostics.push(
          rqlError(
            'BAD_OPERATOR_FOR_FIELD',
            `${describe(expr.field)} does not support ${expr.operator}.`,
            expr.offset,
            expr.length,
            `Supported here: ${field.operators.join(', ')}.`,
          ),
        );
      }
      checkValue(field, expr.value, diagnostics);
      return;
    }

    case 'inTest': {
      const field = resolveField(expr.field, diagnostics);
      if (!field) return;
      if (!field.supportsIn) {
        diagnostics.push(
          rqlError('BAD_OPERATOR_FOR_FIELD', `${describe(expr.field)} does not support IN.`, expr.offset, expr.length),
        );
      }
      for (const value of expr.values) checkValue(field, value, diagnostics);
      return;
    }

    case 'nullTest':
      // spec 02 §5 / RD-006 — IS NULL and IS NOT NULL are valid on every field.
      resolveField(expr.field, diagnostics);
      return;

    case 'call': {
      const spec = PREDICATE_FUNCTIONS[expr.name];
      if (!spec) {
        const hint = nearestName(expr.name, Object.keys(PREDICATE_FUNCTIONS));
        diagnostics.push(
          rqlError(
            'UNKNOWN_FUNCTION',
            `Unknown function ${expr.name}().`,
            expr.offset,
            expr.length,
            hint ? `Did you mean ${hint}()?` : undefined,
          ),
        );
        return;
      }
      if (!spec.implemented) {
        diagnostics.push(rqlError('NOT_IMPLEMENTED', spec.note ?? `${expr.name}() is not implemented.`, expr.offset, expr.length));
        return;
      }
      const [min, max] = spec.arity;
      if (expr.args.length < min || expr.args.length > max) {
        diagnostics.push(
          rqlError(
            'TYPE_MISMATCH',
            `${expr.name}() takes ${min === max ? min : `${min}–${max}`} argument${max === 1 ? '' : 's'}.`,
            expr.offset,
            expr.length,
          ),
        );
      }
      return;
    }

    case 'baselineWas':
      return;

    default:
      return;
  }
}

function resolveField(ref: FieldRef, diagnostics: RqlDiagnostic[]): FieldSpec | null {
  const notImplemented = NOT_IMPLEMENTED_FIELDS[ref.name];
  if (notImplemented) {
    diagnostics.push(rqlError('NOT_IMPLEMENTED', notImplemented, ref.offset, ref.length));
    return null;
  }

  const field = findField(ref.name);
  if (!field) {
    const suggestion = nearestName(ref.name, KNOWN_FIELD_NAMES);
    diagnostics.push(
      rqlError(
        'UNKNOWN_FIELD',
        `Unknown field "${ref.name}".`,
        ref.offset,
        ref.length,
        suggestion ? `Did you mean ${suggestion}?` : `Known fields: ${KNOWN_FIELD_NAMES.slice(0, 8).join(', ')}…`,
      ),
    );
    return null;
  }

  if (field.deprecatedFor) {
    // RD-002 — `page` and `pageHistory` parse, warn, and compile identically.
    diagnostics.push(
      rqlWarning(
        'UNKNOWN_FIELD',
        `"${ref.name}" is a deprecated alias of ${field.deprecatedFor}.`,
        ref.offset,
        ref.length,
        `Use ${field.deprecatedFor} instead.`,
      ),
    );
  }

  if (field.qualifier === 'required' && !ref.qualifier) {
    diagnostics.push(
      rqlError('TYPE_MISMATCH', `${ref.name} needs a name after @, for example ${ref.name}@Category.`, ref.offset, ref.length),
    );
    return null;
  }
  if (field.qualifier === 'none' && ref.qualifier) {
    diagnostics.push(
      rqlError('TYPE_MISMATCH', `${ref.name} does not take a qualifier after @.`, ref.offset, ref.length),
    );
    return null;
  }

  return field;
}

function checkValue(field: FieldSpec, value: Value, diagnostics: RqlDiagnostic[]): void {
  if (value.kind === 'call') {
    const spec = VALUE_FUNCTIONS[value.name];
    if (!spec) {
      diagnostics.push(
        rqlError('UNKNOWN_FUNCTION', `Unknown function ${value.name}() in value position.`, value.offset, value.length),
      );
      return;
    }
    if (value.args.length < spec.arity[0] || value.args.length > spec.arity[1]) {
      diagnostics.push(rqlError('TYPE_MISMATCH', `${value.name}() takes ${spec.arity[0]} argument(s).`, value.offset, value.length));
    }
    return;
  }

  if (value.kind === 'variable') return;

  if (field.enumValues) {
    const text = value.kind === 'string' ? value.value : String(value.value);
    const allowed = field.enumValues.some((candidate) => candidate.toLowerCase() === text.toLowerCase());
    if (!allowed) {
      const suggestion = nearestName(text, field.enumValues);
      diagnostics.push(
        rqlError(
          'TYPE_MISMATCH',
          `"${text}" is not a valid ${field.name} value.`,
          value.offset,
          value.length,
          suggestion ? `Did you mean '${suggestion}'?` : `Valid values: ${field.enumValues.join(', ')}.`,
        ),
      );
    }
  }
}

/**
 * spec: 02 §3.1 / RD-018 — precedence is SQL-conventional, and an un-parenthesised mix of
 * AND and OR gets a warning rather than a silent surprise.
 */
function warnOnMixedPrecedence(expr: Expr, diagnostics: RqlDiagnostic[]): void {
  const visit = (node: Expr): void => {
    switch (node.kind) {
      case 'or':
        if (node.left.kind === 'and' || node.right.kind === 'and') {
          diagnostics.push(
            rqlWarning(
              'AMBIGUOUS_PRECEDENCE',
              'AND binds tighter than OR here. Add parentheses to say which you mean.',
              node.offset,
              node.length,
              'Reqforge reads it as (a AND b) OR c.',
            ),
          );
        }
        visit(node.left);
        visit(node.right);
        return;
      case 'and':
        visit(node.left);
        visit(node.right);
        return;
      case 'not':
      case 'group':
      case 'traversal':
        visit(node.expr);
        return;
      default:
        return;
    }
  };

  visit(expr);
}

/**
 * spec: 02-query-language.md §8 — default scope, applied here so it is visible in the AST.
 * 1. space, unless the query names one or cross-space search is on;
 * 2. `baseline IS NULL` unless the query names a baseline;
 * 3. `status = 'ACTIVE'` unless the query names a status — dropped when a baseline is
 *    named (research §3.1).
 */
function applyDefaultScope(
  expr: Expr,
  context: AnalyserContext,
  diagnostics: RqlDiagnostic[],
): { scoped: Expr; injected: string[] } {
  const injected: string[] = [];
  let scoped = expr;

  const namesSpace = mentionsField(expr, 'spacekey');
  const namesBaseline = mentionsField(expr, 'baseline');
  const namesStatus = mentionsField(expr, 'status');

  if (context.isolated && namesSpace) {
    for (const node of collectSpacePredicates(expr)) {
      if (node.value.kind === 'string' && node.value.value !== context.spaceKey) {
        diagnostics.push(
          rqlError(
            'CROSS_SPACE_NOT_ALLOWED',
            `${context.spaceKey} is an isolated space, so it cannot be searched together with ${node.value.value}.`,
            node.offset,
            node.length,
            'Remove the spaceKey predicate, or search from the other space.',
          ),
        );
      }
    }
  }

  const scopeToSpace = !namesSpace && (context.isolated || !context.crossSpace);
  if (scopeToSpace) {
    scoped = and(
      {
        kind: 'comparison',
        field: { name: 'spacekey', qualifier: null, ...SYNTHETIC },
        operator: '=',
        value: { kind: 'string', value: context.spaceKey, ...SYNTHETIC },
        synthetic: true,
        ...SYNTHETIC,
      },
      scoped,
    );
    injected.push(`spaceKey = '${context.spaceKey}'`);
  }

  if (!namesBaseline) {
    const baseline = context.defaultBaseline ?? null;
    scoped = and(
      baseline === null
        ? { kind: 'nullTest', field: { name: 'baseline', qualifier: null, ...SYNTHETIC }, negated: false, synthetic: true, ...SYNTHETIC }
        : {
            kind: 'comparison',
            field: { name: 'baseline', qualifier: null, ...SYNTHETIC },
            operator: '=',
            value:
              typeof baseline === 'number'
                ? { kind: 'number', value: baseline, ...SYNTHETIC }
                : { kind: 'string', value: baseline, ...SYNTHETIC },
            synthetic: true,
            ...SYNTHETIC,
          },
      scoped,
    );
    injected.push(baseline === null ? 'baseline IS NULL' : `baseline = ${JSON.stringify(baseline)}`);
  }

  // Rule 4: a query that names a baseline includes every status (research §3.1).
  if (!namesStatus && !namesBaseline) {
    scoped = and(
      {
        kind: 'comparison',
        field: { name: 'status', qualifier: null, ...SYNTHETIC },
        operator: '=',
        value: { kind: 'string', value: 'ACTIVE', ...SYNTHETIC },
        synthetic: true,
        ...SYNTHETIC,
      },
      scoped,
    );
    injected.push("status = 'ACTIVE'");
  }

  return { scoped, injected };
}

function collectSpacePredicates(expr: Expr): Array<Extract<Expr, { kind: 'comparison' }>> {
  const found: Array<Extract<Expr, { kind: 'comparison' }>> = [];
  const visit = (node: Expr): void => {
    switch (node.kind) {
      case 'and':
      case 'or':
        visit(node.left);
        visit(node.right);
        return;
      case 'not':
      case 'group':
      case 'traversal':
        visit(node.expr);
        return;
      case 'comparison':
        if (node.field.name === 'spacekey') found.push(node);
        return;
      default:
        return;
    }
  };
  visit(expr);
  return found;
}

function describe(ref: FieldRef): string {
  return ref.qualifier ? `${ref.name === 'property' ? '' : ref.name}@${ref.qualifier}` : ref.name;
}
