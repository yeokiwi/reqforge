import { RqlSyntaxError, rqlError } from './errors';

export type TokenType =
  | 'IDENT'
  | 'STRING'
  | 'NUMBER'
  | 'VARIABLE'
  | 'QUALIFIER'
  | 'OPERATOR'
  | 'PUNCT'
  | 'EOF';

export type Token = {
  type: TokenType;
  /** Decoded value: string contents, identifier text, operator symbol. */
  value: string;
  offset: number;
  length: number;
};

/** spec: 02-query-language.md §2.2 — curly and double quotes are accepted and normalised. */
const QUOTES = new Set(["'", '"', '‘', '’', '“', '”']);
const CLOSING: Record<string, string> = { '‘': '’', '“': '”' };

const OPERATORS = ['->', '→', '<=', '>=', '==', '!=', '=', '~', '<', '>'] as const;

function isIdentStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char);
}

function isIdentPart(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char);
}

/**
 * Turns query text into tokens.
 * spec: 02-query-language.md §2 (RD-019 fixes the lexical rules Requirement Yogi never
 * documented: `\'` and `\\` escapes, `\%` for a literal percent, `_` is not a wildcard).
 */
export function tokenise(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index]!;

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (QUOTES.has(char)) {
      tokens.push(readString(source, index));
      index = tokens[tokens.length - 1]!.offset + tokens[tokens.length - 1]!.length;
      continue;
    }

    if (char === '@') {
      const token = readQualifier(source, index);
      tokens.push(token);
      index = token.offset + token.length;
      continue;
    }

    if (char === '$') {
      let end = index + 1;
      while (end < source.length && isIdentPart(source[end]!)) end += 1;
      tokens.push({ type: 'VARIABLE', value: source.slice(index, end), offset: index, length: end - index });
      index = end;
      continue;
    }

    if (/[0-9]/.test(char) || (char === '-' && /[0-9]/.test(source[index + 1] ?? '') && expectsValue(tokens))) {
      let end = index + 1;
      while (end < source.length && /[0-9.]/.test(source[end]!)) end += 1;
      tokens.push({ type: 'NUMBER', value: source.slice(index, end), offset: index, length: end - index });
      index = end;
      continue;
    }

    const operator = OPERATORS.find((candidate) => source.startsWith(candidate, index));
    if (operator) {
      // `→` is an accepted synonym of `->` (spec 02 §5).
      const value = operator === '→' ? '->' : operator;
      tokens.push({ type: 'OPERATOR', value, offset: index, length: operator.length });
      index += operator.length;
      continue;
    }

    if (char === '(' || char === ')' || char === ',') {
      tokens.push({ type: 'PUNCT', value: char, offset: index, length: 1 });
      index += 1;
      continue;
    }

    if (isIdentStart(char)) {
      let end = index + 1;
      while (end < source.length && isIdentPart(source[end]!)) end += 1;
      tokens.push({ type: 'IDENT', value: source.slice(index, end), offset: index, length: end - index });
      index = end;
      continue;
    }

    throw new RqlSyntaxError(
      rqlError('SYNTAX_ERROR', `Unexpected character "${char}".`, index, 1, 'Remove it, or quote it as a value.'),
    );
  }

  tokens.push({ type: 'EOF', value: '', offset: source.length, length: 0 });
  return tokens;
}

/** A leading `-` is part of a number only where a value may start. */
function expectsValue(tokens: readonly Token[]): boolean {
  const previous = tokens[tokens.length - 1];
  if (!previous) return true;
  if (previous.type === 'OPERATOR') return true;
  return previous.type === 'PUNCT' && previous.value !== ')';
}

function readString(source: string, start: number): Token {
  const opener = source[start]!;
  const closer = CLOSING[opener] ?? (opener === '’' ? '’' : opener);

  let value = '';
  let index = start + 1;

  while (index < source.length) {
    const char = source[index]!;

    if (char === '\\') {
      const next = source[index + 1];
      if (next === "'" || next === '\\' || next === '"') {
        value += next;
        index += 2;
        continue;
      }
      // `\%` survives into the value: the compiler turns it into an escaped literal
      // percent under `~` (spec 02 §2.2).
      value += char;
      index += 1;
      continue;
    }

    if (char === closer) {
      return { type: 'STRING', value, offset: start, length: index + 1 - start };
    }

    value += char;
    index += 1;
  }

  throw new RqlSyntaxError(
    rqlError(
      'UNTERMINATED_STRING',
      'This string is missing its closing quote.',
      start,
      source.length - start,
      "Add a closing ' to the end of the value.",
    ),
  );
}

/**
 * A qualified name: `@Main\ Category`, `@'Main Category'`, `to@refines`.
 * spec: 02-query-language.md §2.3 — backslash escapes the next character; the quoted form
 * is ours (RD-011) and produces the same AST node.
 */
function readQualifier(source: string, start: number): Token {
  let index = start + 1;

  if (QUOTES.has(source[index] ?? '')) {
    const quoted = readString(source, index);
    return { type: 'QUALIFIER', value: quoted.value, offset: start, length: index + quoted.length - start };
  }

  let value = '';
  while (index < source.length) {
    const char = source[index]!;

    if (char === '\\') {
      const next = source[index + 1];
      if (next !== undefined) {
        value += next;
        index += 2;
        continue;
      }
    }

    if (/\s/.test(char) || char === '(' || char === ')' || char === ',') break;
    if (OPERATORS.some((operator) => source.startsWith(operator, index))) break;

    value += char;
    index += 1;
  }

  if (value.length === 0) {
    throw new RqlSyntaxError(
      rqlError('SYNTAX_ERROR', 'A property name is required after @.', start, 1, "For example @Category or @'Main Category'."),
    );
  }

  return { type: 'QUALIFIER', value, offset: start, length: index - start };
}
