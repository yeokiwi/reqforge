import type { ComparisonOperator, Expr, FieldRef, Value } from './ast';
import { RqlSyntaxError, rqlError } from './errors';
import { tokenise, type Token } from './lexer';

const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'is', 'null', 'like', 'was']);

/**
 * Recursive descent over the grammar of spec 02 §3.
 * Precedence, tightest to loosest: `->` › comparison › NOT › AND › OR, all binary
 * operators left-associative (RD-018).
 */
export function parse(source: string): Expr {
  const tokens = tokenise(source);
  let position = 0;

  const peek = (ahead = 0): Token => tokens[Math.min(position + ahead, tokens.length - 1)]!;
  const next = (): Token => tokens[Math.min(position++, tokens.length - 1)]!;

  const isKeyword = (token: Token, word: string): boolean =>
    token.type === 'IDENT' && token.value.toLowerCase() === word;

  const fail = (token: Token, message: string, hint?: string): never => {
    throw new RqlSyntaxError(rqlError('SYNTAX_ERROR', message, token.offset, Math.max(token.length, 1), hint));
  };

  const span = (from: Token, to: { offset: number; length: number }): { offset: number; length: number } => ({
    offset: from.offset,
    length: to.offset + to.length - from.offset,
  });

  function parseExpr(): Expr {
    return parseOr();
  }

  function parseOr(): Expr {
    let left = parseAnd();
    while (isKeyword(peek(), 'or')) {
      next();
      const right = parseAnd();
      left = { kind: 'or', left, right, offset: left.offset, length: right.offset + right.length - left.offset };
    }
    return left;
  }

  function parseAnd(): Expr {
    let left = parseNot();
    while (isKeyword(peek(), 'and')) {
      next();
      const right = parseNot();
      left = { kind: 'and', left, right, offset: left.offset, length: right.offset + right.length - left.offset };
    }
    return left;
  }

  function parseNot(): Expr {
    if (isKeyword(peek(), 'not')) {
      const token = next();
      const expr = parseNot();
      return { kind: 'not', expr, offset: token.offset, length: expr.offset + expr.length - token.offset };
    }
    return parsePrimary();
  }

  function parsePrimary(): Expr {
    const token = peek();

    if (token.type === 'PUNCT' && token.value === '(') {
      const open = next();
      const expr = parseExpr();
      const close = peek();
      if (!(close.type === 'PUNCT' && close.value === ')')) {
        fail(close, 'Expected a closing parenthesis.');
      }
      next();
      return { kind: 'group', expr, offset: open.offset, length: close.offset + 1 - open.offset };
    }

    return parsePredicate();
  }

  function parsePredicate(): Expr {
    const token = peek();

    // `baseline was 3` (spec 02 §3).
    if (isKeyword(token, 'baseline') && isKeyword(peek(1), 'was')) {
      next();
      next();
      const value = parseValue();
      return { kind: 'baselineWas', value, ...span(token, value) };
    }

    // `isModified('7')`, `hasLastTest('%Success%')`.
    if (token.type === 'IDENT' && peek(1).type === 'PUNCT' && peek(1).value === '(') {
      const name = next();
      const args = parseArguments();
      const close = tokens[position - 1]!;
      return { kind: 'call', name: name.value.toLowerCase(), args, ...span(name, close) };
    }

    const field = parseFieldRef();
    const operator = peek();

    if (operator.type === 'OPERATOR' && operator.value === '->') {
      next();
      const target = peek().type === 'PUNCT' && peek().value === '(' ? parsePrimary() : parsePredicate();
      return { kind: 'traversal', field, expr: target, offset: field.offset, length: target.offset + target.length - field.offset };
    }

    if (isKeyword(operator, 'is')) {
      next();
      const negated = isKeyword(peek(), 'not');
      if (negated) next();
      const nullToken = peek();
      if (!isKeyword(nullToken, 'null')) fail(nullToken, 'Expected NULL after IS.');
      next();
      return { kind: 'nullTest', field, negated, offset: field.offset, length: nullToken.offset + nullToken.length - field.offset };
    }

    if (isKeyword(operator, 'in') || (isKeyword(operator, 'not') && isKeyword(peek(1), 'in'))) {
      const negated = isKeyword(operator, 'not');
      if (negated) next();
      next();
      const values = parseArguments();
      const close = tokens[position - 1]!;
      if (values.length === 0) fail(close, 'IN needs at least one value.');
      return { kind: 'inTest', field, values, negated, offset: field.offset, length: close.offset + close.length - field.offset };
    }

    const comparison = parseComparisonOperator();
    const value = parseValue();
    return { kind: 'comparison', field, operator: comparison, value, offset: field.offset, length: value.offset + value.length - field.offset };
  }

  function parseComparisonOperator(): ComparisonOperator {
    const token = peek();

    if (token.type === 'OPERATOR') {
      next();
      switch (token.value) {
        case '=':
        case '==':
          return '=';
        case '!=':
          return '!=';
        case '~':
          return '~';
        case '<':
        case '<=':
        case '>':
        case '>=':
          return token.value;
        default:
          return fail(token, `"${token.value}" cannot be used here.`);
      }
    }

    if (isKeyword(token, 'like')) {
      next();
      return '~';
    }
    if (isKeyword(token, 'not') && isKeyword(peek(1), 'like')) {
      next();
      next();
      return 'NOT LIKE';
    }

    return fail(token, 'Expected an operator such as =, ~, IN or IS NULL.', 'For example: status = \'ACTIVE\'.');
  }

  function parseFieldRef(): FieldRef {
    const token = peek();

    // A bare `@Name` is the inline-property field.
    if (token.type === 'QUALIFIER') {
      next();
      return { name: 'property', qualifier: token.value, offset: token.offset, length: token.length };
    }

    if (token.type !== 'IDENT') {
      return fail(token, 'Expected a field name.', 'For example: key, text, status, @Category.');
    }
    if (KEYWORDS.has(token.value.toLowerCase())) {
      return fail(token, `"${token.value}" is a keyword, not a field name.`);
    }

    next();
    const qualifier = peek();
    if (qualifier.type === 'QUALIFIER' && qualifier.offset === token.offset + token.length) {
      next();
      return {
        name: token.value.toLowerCase(),
        qualifier: qualifier.value,
        offset: token.offset,
        length: qualifier.offset + qualifier.length - token.offset,
      };
    }

    return { name: token.value.toLowerCase(), qualifier: null, offset: token.offset, length: token.length };
  }

  function parseArguments(): Value[] {
    const open = peek();
    if (!(open.type === 'PUNCT' && open.value === '(')) fail(open, 'Expected a parenthesised list of values.');
    next();

    const values: Value[] = [];
    if (peek().type === 'PUNCT' && peek().value === ')') {
      next();
      return values;
    }

    for (;;) {
      values.push(parseValue());
      const separator = peek();
      if (separator.type === 'PUNCT' && separator.value === ',') {
        next();
        continue;
      }
      if (separator.type === 'PUNCT' && separator.value === ')') {
        next();
        return values;
      }
      fail(separator, 'Expected , or ) in the value list.');
    }
  }

  function parseValue(): Value {
    const token = peek();

    switch (token.type) {
      case 'STRING':
        next();
        return { kind: 'string', value: token.value, offset: token.offset, length: token.length };
      case 'NUMBER': {
        next();
        return { kind: 'number', value: Number(token.value), offset: token.offset, length: token.length };
      }
      case 'VARIABLE':
        next();
        return { kind: 'variable', name: token.value, offset: token.offset, length: token.length };
      case 'IDENT': {
        // `user('ada')` is the only value-position function (spec 02 §6); a bare word is
        // accepted as a string so `status = ACTIVE` and `baseline = current` work.
        if (peek(1).type === 'PUNCT' && peek(1).value === '(') {
          const name = next();
          const args = parseArguments();
          const close = tokens[position - 1]!;
          return {
            kind: 'call',
            name: name.value.toLowerCase(),
            args,
            offset: name.offset,
            length: close.offset + close.length - name.offset,
          };
        }
        next();
        return { kind: 'string', value: token.value, offset: token.offset, length: token.length };
      }
      default:
        return fail(token, 'Expected a value.', "Values are quoted strings, numbers, or $variables.");
    }
  }

  const expr = parseExpr();
  const trailing = peek();
  if (trailing.type !== 'EOF') {
    fail(trailing, `Unexpected "${trailing.value}" after the end of the query.`);
  }
  return expr;
}
