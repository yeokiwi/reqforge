/**
 * Requirement type rules.
 * spec: 06-requirement-types.md §1 — the first three kinds are what Requirement Yogi
 * documents; `PROPERTY_MATCHES` and `PROPERTY_IN` are ours (`RD-015`), because RY has no
 * rule expression language at all and its own docs say not to count on one.
 *
 * Pure, and declared independently of Prisma: `src/domain/**` may not import from the
 * database layer, and a rule read from JSON is untrusted until `parseRule` narrows it.
 */

export type RuleDirection = 'to' | 'from';

export type Rule =
  | { kind: 'REQUIRED_PROPERTY'; name: string }
  | { kind: 'OPTIONAL_PROPERTY'; name: string }
  | { kind: 'REQUIRED_DEPENDENCY'; relationship: string; direction: RuleDirection }
  | { kind: 'PROPERTY_MATCHES'; name: string; pattern: string }
  | { kind: 'PROPERTY_IN'; name: string; values: string[] };

export type RuleKind = Rule['kind'];

export const RULE_KINDS: readonly RuleKind[] = [
  'REQUIRED_PROPERTY',
  'OPTIONAL_PROPERTY',
  'REQUIRED_DEPENDENCY',
  'PROPERTY_MATCHES',
  'PROPERTY_IN',
];

export const RULE_LABELS: Readonly<Record<RuleKind, string>> = {
  REQUIRED_PROPERTY: 'must have the property',
  OPTIONAL_PROPERTY: 'should have the property',
  REQUIRED_DEPENDENCY: 'must have a dependency',
  PROPERTY_MATCHES: 'property must match the pattern',
  PROPERTY_IN: 'property must be one of',
};

/** spec: 06-requirement-types.md §2.3 — the limits, which are ours, not RY's. */
export const MAX_RULES_PER_TYPE = 40;
export const MAX_TYPES_PER_DOCUMENT = 20;

/** A property is found by its lowercased name, as everywhere else (`RD-011`). */
export function lookupName(name: string): string {
  return name.trim().toLowerCase();
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Narrows one stored row into a `Rule`, or refuses it. A rule whose shape is wrong is
 * dropped rather than allowed to reach the validator, where a missing name would quietly
 * pass every requirement.
 */
export function parseRule(row: unknown): Rule | null {
  if (typeof row !== 'object' || row === null) return null;
  const record = row as Record<string, unknown>;
  const kind = asString(record.kind);

  switch (kind) {
    case 'REQUIRED_PROPERTY':
    case 'OPTIONAL_PROPERTY': {
      const name = asString(record.name);
      return name ? { kind, name } : null;
    }
    case 'REQUIRED_DEPENDENCY': {
      const relationship = asString(record.relationship);
      const direction = asString(record.direction);
      if (!relationship || (direction !== 'to' && direction !== 'from')) return null;
      return { kind, relationship, direction };
    }
    case 'PROPERTY_MATCHES': {
      const name = asString(record.name);
      const pattern = asString(record.pattern);
      return name && pattern ? { kind, name, pattern } : null;
    }
    case 'PROPERTY_IN': {
      const name = asString(record.name);
      const values = Array.isArray(record.values)
        ? record.values.flatMap((value) => {
            const text = asString(value);
            return text ? [text] : [];
          })
        : [];
      return name && values.length > 0 ? { kind, name, values } : null;
    }
    default:
      return null;
  }
}

export function parseRules(rows: unknown): Rule[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const rule = parseRule(row);
    return rule ? [rule] : [];
  });
}

/**
 * A `PROPERTY_MATCHES` pattern is a type author's regular expression, so it may not
 * compile. An uncompilable pattern is a rule that never matches — never a crash in the
 * indexer or in a job.
 */
export function compilePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

/** Describes a rule in the words the screens and the diagnostics use. */
export function describeRule(rule: Rule): string {
  switch (rule.kind) {
    case 'REQUIRED_PROPERTY':
    case 'OPTIONAL_PROPERTY':
      return `${RULE_LABELS[rule.kind]} ${rule.name}`;
    case 'REQUIRED_DEPENDENCY':
      return `${RULE_LABELS[rule.kind]} ${rule.direction === 'to' ? 'on' : 'from'} ${rule.relationship}`;
    case 'PROPERTY_MATCHES':
      return `${rule.name} ${RULE_LABELS[rule.kind]} ${rule.pattern}`;
    case 'PROPERTY_IN':
      return `${rule.name} ${RULE_LABELS[rule.kind]} ${rule.values.join(', ')}`;
  }
}
