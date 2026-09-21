import type { ComparisonOperator, Expr, FieldRef, Value } from './ast';
import { rqlError, RqlSyntaxError } from './errors';
import { findField } from './fields';
import { join, param, raw, render, sql, substituteAlias, type RenderedSql, type SqlFragment } from './sql';

export type CompileContext = {
  /**
   * The mandatory visibility predicate (spec 07 rule X3, RD-017). It is compiled into
   * every query; `$alias` is replaced with the requirement alias in scope. There is no
   * code path that reads requirements without it, so it has no default.
   */
  visibility: SqlFragment;
  /** Resolves `$currentBaseline` (spec 02 §4). */
  currentBaselineId?: string | null;
  /** Ordering and paging for the outer query. */
  limit?: number;
  offset?: number;
};

export type CompiledQuery = RenderedSql & { countText: string; countParams: unknown[] };

const REQUIREMENT_TABLE = '"Requirement"';

/**
 * AST → parameterised SQL.
 * spec: 02-query-language.md §5 (operators), §7 (two-valued logic, absence-as-false),
 * §5.1–5.2 (traversal by repeated joins, depth-capped).
 *
 * Every predicate returns TRUE or FALSE and never NULL, which is what makes
 * `NOT (@Category = 'Functional')` include requirements that have no Category (RD-020).
 */
export function compile(expr: Expr, context: CompileContext): CompiledQuery {
  const where = compileExpr(expr, 'r', context);
  const visibility = substituteAlias(context.visibility, 'r');

  const selection = sql`
    SELECT r.id, r."spaceId", r.key, r."upperKey", r.title, r."bodyHtml", r.status,
           r."baselineId", r."typeId", r."originVersionId", r."anchorPath"
    FROM ${raw(REQUIREMENT_TABLE)} r
    WHERE (${where}) AND (${visibility})
    ORDER BY r."upperKey" ASC
    LIMIT ${param(Math.min(Math.max(context.limit ?? 100, 1), 600))}
    OFFSET ${param(Math.max(context.offset ?? 0, 0))}
  `;

  const counting = sql`
    SELECT COUNT(*)::int AS count
    FROM ${raw(REQUIREMENT_TABLE)} r
    WHERE (${where}) AND (${visibility})
  `;

  const rendered = render(selection);
  const countRendered = render(counting);
  return { ...rendered, countText: countRendered.text, countParams: countRendered.params };
}

/** The WHERE fragment alone, for callers that build their own projection (matrix, export). */
export function compilePredicate(expr: Expr, alias: string, context: CompileContext): SqlFragment {
  return compileExpr(expr, alias, context);
}

function compileExpr(expr: Expr, alias: string, context: CompileContext): SqlFragment {
  switch (expr.kind) {
    case 'and':
      return sql`(${compileExpr(expr.left, alias, context)} AND ${compileExpr(expr.right, alias, context)})`;
    case 'or':
      return sql`(${compileExpr(expr.left, alias, context)} OR ${compileExpr(expr.right, alias, context)})`;
    case 'not':
      // Two-valued logic: the operand is never NULL, so NOT is the plain complement
      // over the current result set (spec 02 §7, RD-020).
      return sql`(NOT ${compileExpr(expr.expr, alias, context)})`;
    case 'group':
      return sql`(${compileExpr(expr.expr, alias, context)})`;
    case 'comparison':
      return compileComparison(expr.field, expr.operator, expr.value, alias, context);
    case 'nullTest': {
      const isNull = compileIsNull(expr.field, alias, context);
      return expr.negated ? sql`(NOT ${isNull})` : isNull;
    }
    case 'inTest': {
      const any = join(
        expr.values.map((value) => compileComparison(expr.field, '=', value, alias, context)),
        ' OR ',
      );
      const members = sql`(${any})`;
      return expr.negated ? sql`(NOT ${members})` : members;
    }
    case 'traversal':
      return compileTraversal(expr.field, expr.expr, alias, context);
    case 'call':
      return compileCall(expr, alias, context);
    case 'baselineWas':
      throw new RqlSyntaxError(
        rqlError(
          'NOT_IMPLEMENTED',
          '`baseline was` needs requirement history, which arrives with diff (spec 05 §5).',
          expr.offset,
          expr.length,
          'Compare two baselines with the diff screen instead.',
        ),
      );
  }
}

// ---------------------------------------------------------------- comparisons

function compileComparison(
  field: FieldRef,
  operator: ComparisonOperator,
  value: Value,
  alias: string,
  context: CompileContext,
): SqlFragment {
  if (operator === '!=' || operator === 'NOT LIKE') {
    const positive = compileComparison(field, operator === '!=' ? '=' : '~', value, alias, context);
    return sql`(NOT ${positive})`;
  }

  const spec = findField(field.name);
  const name = spec?.deprecatedFor ?? field.name;

  switch (name) {
    case 'key':
      return textCompare(sql`${raw(alias)}."upperKey"`, operator, upperValue(value), { collate: false });
    case 'key_case_sensitive':
      return textCompare(sql`${raw(alias)}."key"`, operator, literal(value), { collate: true });
    case 'spacekey':
      return existsSpace(alias, operator, value);
    case 'status':
      return textCompare(sql`${raw(alias)}."status"::text`, operator, upperValue(value), { collate: false });
    case 'text':
      return textCompare(sql`${raw(alias)}."bodySearch"`, operator, literal(value), { collate: false });
    case 'title':
      return textCompare(sql`${raw(alias)}."title"`, operator, literal(value), { collate: false });
    case 'baseline':
      return compileBaseline(alias, operator, value, context);
    case 'document':
      return existsDocument(alias, operator, value, { originOnly: true, anyVersion: false });
    case 'documenthistory':
      return existsDocument(alias, operator, value, { originOnly: false, anyVersion: true });
    case 'links':
      return existsDocument(alias, operator, value, { originOnly: false, anyVersion: true });
    case 'property':
      return existsProperty(alias, 'INLINE', field.qualifier, operator, value);
    case 'ext':
      return existsProperty(alias, 'EXTERNAL', field.qualifier, operator, value);
    case 'to':
    case 'parent':
      return existsDependency(alias, 'parent', field.qualifier, operator, value);
    case 'from':
    case 'child':
      return existsDependency(alias, 'child', field.qualifier, operator, value);
    case 'type':
      return sql`EXISTS (SELECT 1 FROM "RequirementType" t WHERE t.id = ${raw(alias)}."typeId" AND ${textCompare(
        raw('t.name'),
        operator,
        literal(value),
        { collate: false },
      )})`;
    case 'label':
      return sql`EXISTS (SELECT 1 FROM "RequirementLabel" rl WHERE rl."requirementId" = ${raw(alias)}.id AND ${textCompare(
        raw('rl.label'),
        operator,
        literal(value),
        { collate: false },
      )})`;
    case 'rulestatus':
      return existsValidation(alias, field.qualifier, operator, value);
    default:
      // The analyser rejects unknown fields before the compiler ever runs.
      return raw('FALSE');
  }
}

type CompareOptions = { collate: boolean };

function textCompare(
  column: SqlFragment,
  operator: ComparisonOperator,
  value: SqlFragment,
  options: CompareOptions,
): SqlFragment {
  if (operator === '~') {
    return sql`(${column} ILIKE ${value} ESCAPE '\\')`;
  }
  if (operator === '=') {
    return sql`(${column} = ${value})`;
  }

  // spec 02 §5: numeric when both sides parse as numbers, otherwise a C-collation string
  // comparison, which is what makes `@ReleaseDate > '2026-06-30'` work on ISO dates.
  const collated = options.collate ? sql`${column} COLLATE "C"` : column;
  return sql`(${collated} ${raw(operator)} ${value})`;
}

/** A pattern for ILIKE: `%` stays a wildcard, `\%` becomes a literal, `_` is not one. */
export function toLikePattern(value: string): string {
  let out = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char === '\\' && value[index + 1] === '%') {
      out += '\\%';
      index += 1;
      continue;
    }
    if (char === '\\' && value[index + 1] === '\\') {
      out += '\\\\';
      index += 1;
      continue;
    }
    if (char === '_') {
      out += '\\_';
      continue;
    }
    out += char;
  }
  return out;
}

function literal(value: Value, options: { like?: boolean } = {}): SqlFragment {
  switch (value.kind) {
    case 'string':
      return param(options.like ? toLikePattern(value.value) : value.value);
    case 'number':
      return param(String(value.value));
    case 'variable':
      return param(value.name);
    case 'call':
      // `user('ada')` matches a username or a stable id; both are the same parameter.
      return param(value.args[0] && value.args[0].kind === 'string' ? value.args[0].value : '');
  }
}

/** The user-visible text of a value, whatever its kind. */
function valueText(value: Value): string {
  switch (value.kind) {
    case 'string':
      return value.value;
    case 'number':
      return String(value.value);
    case 'variable':
      return value.name;
    case 'call':
      return value.args[0] && value.args[0].kind === 'string' ? value.args[0].value : '';
  }
}

function upperValue(value: Value): SqlFragment {
  const base = literal(value);
  return sql`UPPER(${base})`;
}

// ---------------------------------------------------------------- field helpers

function existsSpace(alias: string, operator: ComparisonOperator, value: Value): SqlFragment {
  return sql`EXISTS (SELECT 1 FROM "Space" s WHERE s.id = ${raw(alias)}."spaceId" AND ${textCompare(
    raw('s.key'),
    operator,
    patternAware(operator, value),
    { collate: true },
  )})`;
}

function patternAware(operator: ComparisonOperator, value: Value): SqlFragment {
  return operator === '~' ? literal(value, { like: true }) : literal(value);
}

function compileBaseline(
  alias: string,
  operator: ComparisonOperator,
  value: Value,
  context: CompileContext,
): SqlFragment {
  if (value.kind === 'variable' && value.name.toLowerCase() === '$currentbaseline') {
    const current = context.currentBaselineId ?? null;
    return current === null
      ? sql`(${raw(alias)}."baselineId" IS NULL)`
      : sql`(${raw(alias)}."baselineId" = ${param(current)})`;
  }

  const numeric = value.kind === 'number' ? value.value : Number(value.kind === 'string' ? value.value : NaN);

  if (Number.isFinite(numeric)) {
    return sql`EXISTS (SELECT 1 FROM "Baseline" b WHERE b.id = ${raw(alias)}."baselineId" AND b.number ${raw(
      operator === '~' ? '=' : operator,
    )} ${param(Math.trunc(numeric))})`;
  }

  return sql`EXISTS (SELECT 1 FROM "Baseline" b WHERE b.id = ${raw(alias)}."baselineId" AND ${textCompare(
    raw('b.name'),
    operator,
    patternAware(operator, value),
    { collate: false },
  )})`;
}

function existsDocument(
  alias: string,
  operator: ComparisonOperator,
  value: Value,
  options: { originOnly: boolean; anyVersion: boolean },
): SqlFragment {
  const originClause = options.originOnly ? raw('AND dl.origin') : raw('');
  // `document` accepts an id or a title (spec 02 §4).
  const match = sql`(${textCompare(raw('d.id'), operator === '~' ? '=' : operator, literal(value), { collate: true })} OR ${textCompare(
    raw('d.title'),
    operator,
    patternAware(operator, value),
    { collate: false },
  )})`;

  return sql`EXISTS (
    SELECT 1 FROM "DocumentLink" dl
    JOIN "DocumentVersion" dv ON dv.id = dl."versionId"
    JOIN "Document" d ON d.id = dv."documentId"
    WHERE dl."requirementId" = ${raw(alias)}.id ${originClause} AND ${match}
  )`;
}

function existsProperty(
  alias: string,
  kind: 'INLINE' | 'EXTERNAL',
  qualifier: string | null,
  operator: ComparisonOperator,
  value: Value,
): SqlFragment {
  const name = (qualifier ?? '').trim().toLowerCase();

  // A list-valued property is one row per member, so `=` is set membership (RD-027).
  const comparison =
    operator === '~'
      ? sql`(p.value ILIKE ${literal(value, { like: true })} ESCAPE '\\')`
      : operator === '='
        ? sql`(p.value = ${literal(value)})`
        : numericAwareCompare(raw('p.value'), operator, value);

  return sql`EXISTS (
    SELECT 1 FROM "Property" p
    WHERE p."requirementId" = ${raw(alias)}.id
      AND p.kind = ${param(kind)}::"PropertyKind"
      AND p."searchName" = ${param(name)}
      AND ${comparison}
  )`;
}

/**
 * spec 02 §5 — ordered comparison is numeric when both sides parse as numbers, and a
 * C-collation string comparison otherwise.
 */
function numericAwareCompare(column: SqlFragment, operator: ComparisonOperator, value: Value): SqlFragment {
  const asText = literal(value);
  const numeric = value.kind === 'number' ? value.value : Number(valueText(value));

  if (Number.isFinite(numeric)) {
    return sql`(${column} ~ '^-?[0-9]+(\\.[0-9]+)?$' AND (${column})::numeric ${raw(operator)} ${param(numeric)})`;
  }
  return sql`(${column} COLLATE "C" ${raw(operator)} ${asText})`;
}

function existsDependency(
  alias: string,
  direction: 'parent' | 'child',
  relationship: string | null,
  operator: ComparisonOperator,
  value: Value,
): SqlFragment {
  // Invariant P1: the requirement containing the link is the CHILD, so `to`/`parent`
  // walks child → parent and `from`/`child` walks parent → child.
  const [selfColumn, otherColumn] =
    direction === 'parent' ? ['"childId"', '"parentId"'] : ['"parentId"', '"childId"'];

  const relationshipClause = relationship
    ? sql`AND d.relationship = ${param(relationship)}`
    : raw('');

  return sql`EXISTS (
    SELECT 1 FROM "Dependency" d
    JOIN ${raw(REQUIREMENT_TABLE)} other ON other.id = d.${raw(otherColumn)}
    WHERE d.${raw(selfColumn)} = ${raw(alias)}.id ${relationshipClause}
      AND ${textCompare(raw('other."upperKey"'), operator, upperValue(value), { collate: false })}
  )`;
}

function existsValidation(
  alias: string,
  qualifier: string | null,
  operator: ComparisonOperator,
  value: Value,
): SqlFragment {
  const status = valueText(value).toUpperCase();
  const typeClause = qualifier
    ? sql`AND (rv."typeId" = ${param(qualifier)} OR EXISTS (SELECT 1 FROM "RequirementType" rt WHERE rt.id = rv."typeId" AND rt.name = ${param(qualifier)}))`
    : raw('');

  const comparison =
    operator === '='
      ? sql`rv.status::text = ${param(status)}`
      : sql`rv.status::text ${raw(operator === '~' ? '=' : operator)} ${param(status)}`;

  return sql`EXISTS (
    SELECT 1 FROM "RequirementValidation" rv
    WHERE rv."requirementId" = ${raw(alias)}.id ${typeClause} AND ${comparison}
  )`;
}

// ---------------------------------------------------------------- traversal

let traversalCounter = 0;

/**
 * spec 02 §5.1–5.2 / RD-021 — existential traversal as repeated joins, never a recursive
 * CTE, so a cyclic dependency graph terminates at the depth cap by construction.
 */
function compileTraversal(field: FieldRef, target: Expr, alias: string, context: CompileContext): SqlFragment {
  traversalCounter = (traversalCounter + 1) % 1_000_000;
  const nextAlias = `t${traversalCounter}`;

  const spec = findField(field.name);
  const name = spec?.deprecatedFor ?? field.name;
  const [selfColumn, otherColumn] =
    name === 'to' || name === 'parent' ? ['"childId"', '"parentId"'] : ['"parentId"', '"childId"'];

  const relationshipClause = field.qualifier ? sql`AND d.relationship = ${param(field.qualifier)}` : raw('');
  const inner = compileExpr(target, nextAlias, context);
  const visibility = substituteAlias(context.visibility, nextAlias);

  return sql`EXISTS (
    SELECT 1 FROM "Dependency" d
    JOIN ${raw(REQUIREMENT_TABLE)} ${raw(nextAlias)} ON ${raw(nextAlias)}.id = d.${raw(otherColumn)}
    WHERE d.${raw(selfColumn)} = ${raw(alias)}.id ${relationshipClause}
      AND (${inner}) AND (${visibility})
  )`;
}

// ---------------------------------------------------------------- IS NULL and calls

/** spec 02 §7 — `IS NULL` means "no row exists, or the value is the empty string". */
function compileIsNull(field: FieldRef, alias: string, context: CompileContext): SqlFragment {
  const spec = findField(field.name);
  const name = spec?.deprecatedFor ?? field.name;

  switch (name) {
    case 'baseline':
      return sql`(${raw(alias)}."baselineId" IS NULL)`;
    case 'key':
    case 'key_case_sensitive':
      return sql`(${raw(alias)}."key" IS NULL OR ${raw(alias)}."key" = '')`;
    case 'text':
      return sql`(${raw(alias)}."bodySearch" IS NULL OR ${raw(alias)}."bodySearch" = '')`;
    case 'title':
      return sql`(${raw(alias)}."title" IS NULL OR ${raw(alias)}."title" = '')`;
    case 'status':
      return raw('FALSE');
    case 'type':
      return sql`(${raw(alias)}."typeId" IS NULL)`;
    default: {
      // Everything else is an EXISTS field: "no row exists" is exactly NOT EXISTS with a
      // wildcard value.
      const anyValue: Value = { kind: 'string', value: '%', offset: 0, length: 0 };
      return sql`(NOT ${compileComparison(field, '~', anyValue, alias, context)})`;
    }
  }
}

function compileCall(expr: Extract<Expr, { kind: 'call' }>, alias: string, context: CompileContext): SqlFragment {
  if (expr.name === 'ismodified') {
    throw new RqlSyntaxError(
      rqlError(
        'NOT_IMPLEMENTED',
        'isModified() compares a requirement against a baseline snapshot, which arrives with diff (spec 05 §5, RD-013).',
        expr.offset,
        expr.length,
      ),
    );
  }

  void alias;
  void context;
  throw new RqlSyntaxError(
    rqlError('NOT_IMPLEMENTED', `${expr.name}() is not implemented.`, expr.offset, expr.length),
  );
}

export { render } from './sql';
export type { SqlFragment } from './sql';
