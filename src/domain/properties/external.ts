import type { Aggregate } from '@/domain/traceability/matrix';

/**
 * External properties: values owned by the reader rather than by the document.
 * spec: 01-domain-model.md (Property, ExternalPropertyDefinition); 04 §2.1–2.2
 *
 * Pure. The data type is declared once on the definition and then does three jobs:
 * it decides what a value may be (`coerceValue`), how a column aggregates
 * (`aggregateValues`), and how `ext@` compiles (RD-037).
 */

/**
 * Mirrors the `DataType` enum in the Prisma schema. Declared here rather than imported,
 * because `src/domain/**` may not import from the database layer.
 */
export type DataType = 'STRING' | 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'ENUM';

export const DATA_TYPES: readonly DataType[] = ['STRING', 'TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'ENUM'];

export function isDataType(value: unknown): value is DataType {
  return typeof value === 'string' && (DATA_TYPES as readonly string[]).includes(value);
}

export const DATA_TYPE_LABELS: Readonly<Record<DataType, string>> = {
  STRING: 'Text, one line',
  TEXT: 'Text, long',
  NUMBER: 'Number',
  BOOLEAN: 'Yes or no',
  DATE: 'Date (YYYY-MM-DD)',
  ENUM: 'One of a fixed list',
};

/** Ours, not Requirement Yogi's: a value is a field, not a document (spec 07 §4 style). */
export const VALUE_MAX = { TEXT: 10_000, OTHER: 1_000 } as const;

export const NAME_MAX = 64;

/** The shape the query engine, the matrix and the screens all read a definition through. */
export type ExternalDefinition = {
  id: string;
  name: string;
  searchName: string;
  dataType: DataType;
  enumValues: string[];
  description: string | null;
};

export type NamedValue = { name: string; searchName: string; searchable: boolean };

/**
 * A property is looked up by its name with spaces and case removed from the comparison.
 * spec: 01-domain-model.md (Property), RD-011 — the name is stored verbatim as well,
 * because the display name is the author's, not ours.
 */
export function normaliseName(raw: unknown): NamedValue | null {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (name.length === 0 || name.length > NAME_MAX) return null;

  return {
    name,
    searchName: name.toLowerCase(),
    // spec 03 §7 — PROPERTY_NAME_NOT_SEARCHABLE: RY simply says a searchable column
    // cannot contain a space, so a name that does is allowed but warned about.
    searchable: !name.includes(' '),
  };
}

export type Coerced = { ok: true; value: string | null } | { ok: false; message: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TRUTHY = new Set(['true', 'yes', '1']);
const FALSY = new Set(['false', 'no', '0']);

/**
 * Turns what a person typed into what is stored, or explains why it cannot be.
 * A blank value means "clear this", which is why `value` may be null.
 *
 * Storage stays `String` throughout: the data type is a contract about the text, so that
 * `ext@ReleaseDate > '2026-06-30'` compares dates and `ext@Risk > 3` compares numbers
 * (spec 02 §5, RD-037) without a column per type.
 */
export function coerceValue(definition: Pick<ExternalDefinition, 'dataType' | 'enumValues'>, raw: unknown): Coerced {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
    return { ok: false, message: 'A value must be text, a number or a boolean.' };
  }

  const text = String(raw).trim();
  if (text.length === 0) return { ok: true, value: null };

  const max = definition.dataType === 'TEXT' ? VALUE_MAX.TEXT : VALUE_MAX.OTHER;
  if (text.length > max) {
    return { ok: false, message: `A ${definition.dataType.toLowerCase()} value may be at most ${max} characters.` };
  }

  switch (definition.dataType) {
    case 'STRING':
    case 'TEXT':
      return { ok: true, value: text };

    case 'NUMBER': {
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) return { ok: false, message: `"${text}" is not a number.` };
      return { ok: true, value: formatNumber(parsed) };
    }

    case 'BOOLEAN': {
      const lower = text.toLowerCase();
      if (TRUTHY.has(lower)) return { ok: true, value: 'true' };
      if (FALSY.has(lower)) return { ok: true, value: 'false' };
      return { ok: false, message: `"${text}" is not a yes or a no. Use true or false.` };
    }

    case 'DATE': {
      if (!ISO_DATE.test(text) || !isRealDate(text)) {
        return { ok: false, message: `"${text}" is not a date. Use YYYY-MM-DD.` };
      }
      return { ok: true, value: text };
    }

    case 'ENUM': {
      // Property values are case-sensitive (spec 02 §2.1), so membership is exact.
      if (!definition.enumValues.includes(text)) {
        const allowed = definition.enumValues.join(', ');
        return {
          ok: false,
          message: definition.enumValues.length > 0
            ? `"${text}" is not one of: ${allowed}.`
            : `"${text}" cannot be stored: that property has no values defined yet.`,
        };
      }
      return { ok: true, value: text };
    }
  }
}

function isRealDate(text: string): boolean {
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

/** Drops floating-point noise without silently losing a real digit. */
function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(12)));
}

/**
 * Ordering a value by its declared type: numerically for NUMBER, and otherwise by code
 * unit, which is the C collation the compiler uses for the same comparison (spec 02 §5).
 * ISO dates sort correctly either way — that is why the format is pinned.
 */
export function compareValues(dataType: DataType, a: string, b: string): number {
  if (dataType === 'NUMBER') {
    const left = Number(a);
    const right = Number(b);
    if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export type Aggregated = { ok: true; text: string } | { ok: false; message: string };

/**
 * The five aggregations a matrix column may carry, recomputed live as values are edited.
 * spec: 04-traceability-and-coverage.md §2.1 (research §2.6 names the same set)
 *
 * `sum` and `avg` are refused on a non-numeric definition rather than returning NaN: a
 * column footer reading "NaN" is a bug report waiting to happen.
 */
export function aggregateValues(fn: Aggregate, dataType: DataType, values: readonly string[]): Aggregated {
  const present = values.filter((value) => value.trim().length > 0);

  if (fn === 'count') return { ok: true, text: String(present.length) };
  if (present.length === 0) return { ok: true, text: '—' };

  if (fn === 'sum' || fn === 'avg') {
    if (dataType !== 'NUMBER') {
      return { ok: false, message: `${fn} needs a number property; ${dataType.toLowerCase()} values cannot be added.` };
    }
    const numbers = present.map(Number);
    if (numbers.some((value) => !Number.isFinite(value))) {
      return { ok: false, message: `${fn} cannot run: one of the values is not a number.` };
    }
    const total = numbers.reduce((left, right) => left + right, 0);
    return { ok: true, text: formatNumber(fn === 'sum' ? total : total / numbers.length) };
  }

  const sorted = [...present].sort((a, b) => compareValues(dataType, a, b));
  return { ok: true, text: fn === 'min' ? sorted[0]! : sorted[sorted.length - 1]! };
}

/**
 * The declared types, keyed by lookup name, as the query engine receives them.
 * RD-037: the analyser and the compiler stay pure — the types arrive as data, exactly
 * as the visibility predicate does.
 */
export type ExternalTypeMap = Readonly<Record<string, Pick<ExternalDefinition, 'dataType' | 'enumValues'>>>;

export function externalTypeMap(definitions: readonly ExternalDefinition[]): ExternalTypeMap {
  return Object.fromEntries(
    definitions.map((definition) => [
      definition.searchName,
      { dataType: definition.dataType, enumValues: definition.enumValues },
    ]),
  );
}
