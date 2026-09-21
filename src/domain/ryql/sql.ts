/**
 * A tiny SQL builder. The compiler is the only place SQL is written (spec 02 §1), and it
 * **never string-interpolates a user value**: every value becomes a placeholder.
 *
 * It deliberately does not use Prisma's `Prisma.sql`: `src/domain/**` is pure and has no
 * database imports (CLAUDE.md). The repository layer renders this to `$1, $2 …` and hands
 * the parameters to the driver.
 */
export type SqlPart = string | { readonly param: unknown };

export type SqlFragment = { readonly parts: readonly SqlPart[] };

export type RenderedSql = { text: string; params: unknown[] };

/** A literal chunk of SQL written by the compiler itself — never user input. */
export function raw(text: string): SqlFragment {
  return { parts: [text] };
}

/** A user value. It only ever reaches the database as a bound parameter. */
export function param(value: unknown): SqlFragment {
  return { parts: [{ param: value }] };
}

export function sql(strings: TemplateStringsArray, ...values: Array<SqlFragment | SqlFragment[]>): SqlFragment {
  const parts: SqlPart[] = [];

  strings.forEach((chunk, index) => {
    if (chunk.length > 0) parts.push(chunk);
    const value = values[index];
    if (value === undefined) return;
    for (const fragment of Array.isArray(value) ? value : [value]) {
      parts.push(...fragment.parts);
    }
  });

  return { parts };
}

export function join(fragments: readonly SqlFragment[], separator: string): SqlFragment {
  const parts: SqlPart[] = [];
  fragments.forEach((fragment, index) => {
    if (index > 0) parts.push(separator);
    parts.push(...fragment.parts);
  });
  return { parts };
}

export function concat(fragments: readonly SqlFragment[]): SqlFragment {
  return join(fragments, '');
}

/** Numbers the placeholders and collects their values, in order. */
export function render(fragment: SqlFragment, startIndex = 1): RenderedSql {
  const params: unknown[] = [];
  let text = '';
  let next = startIndex;

  for (const part of fragment.parts) {
    if (typeof part === 'string') {
      text += part;
      continue;
    }
    params.push(part.param);
    text += `$${next}`;
    next += 1;
  }

  return { text: text.replace(/\s+/g, ' ').trim(), params };
}

/**
 * Rebinds a fragment written against `$alias` to a concrete alias. The visibility
 * predicate (spec 07 rule X3) is written once and applied to the outer query, to every
 * traversal hop, and to the far side of a matrix dependency column.
 */
export function substituteAlias(fragment: SqlFragment, alias: string): SqlFragment {
  return {
    parts: fragment.parts.map((part) => (typeof part === 'string' ? part.replaceAll('$alias', alias) : part)),
  };
}

export const TRUE: SqlFragment = raw('TRUE');
export const FALSE: SqlFragment = raw('FALSE');
