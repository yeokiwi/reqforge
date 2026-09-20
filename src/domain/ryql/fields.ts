import type { ComparisonOperator } from './ast';

export type FieldKind = 'string' | 'number' | 'enum' | 'key' | 'id' | 'property' | 'dependency' | 'baseline';

export type FieldSpec = {
  name: string;
  kind: FieldKind;
  /** A qualifier after `@` is required, optional, or refused. */
  qualifier: 'required' | 'optional' | 'none';
  operators: readonly ComparisonOperator[];
  supportsIn: boolean;
  supportsTraversal: boolean;
  enumValues?: readonly string[];
  /** Replacement field for a deprecated alias (RD-002). */
  deprecatedFor?: string;
  description: string;
};

const STRING_OPERATORS: readonly ComparisonOperator[] = ['=', '!=', '~', 'NOT LIKE'];
const ORDERED_OPERATORS: readonly ComparisonOperator[] = ['=', '!=', '~', 'NOT LIKE', '<', '<=', '>', '>='];

/** spec: 02-query-language.md §4 — the field table. */
export const FIELDS: readonly FieldSpec[] = [
  { name: 'key', kind: 'key', qualifier: 'none', operators: STRING_OPERATORS, supportsIn: true, supportsTraversal: false, description: 'The requirement key, matched case-insensitively.' },
  { name: 'key_case_sensitive', kind: 'key', qualifier: 'none', operators: STRING_OPERATORS, supportsIn: true, supportsTraversal: false, description: 'The requirement key, matched case-sensitively.' },
  { name: 'spacekey', kind: 'string', qualifier: 'none', operators: STRING_OPERATORS, supportsIn: true, supportsTraversal: false, description: 'The space key, case-sensitive.' },
  { name: 'status', kind: 'enum', qualifier: 'none', operators: ['=', '!='], supportsIn: true, supportsTraversal: false, enumValues: ['ACTIVE', 'ARCHIVED', 'MOVED', 'DELETED'], description: 'The requirement status.' },
  { name: 'text', kind: 'string', qualifier: 'none', operators: STRING_OPERATORS, supportsIn: false, supportsTraversal: false, description: 'The requirement text. Excludes properties (research §3.2).' },
  { name: 'title', kind: 'string', qualifier: 'none', operators: STRING_OPERATORS, supportsIn: false, supportsTraversal: false, description: 'The requirement title.' },
  { name: 'baseline', kind: 'baseline', qualifier: 'none', operators: ORDERED_OPERATORS, supportsIn: true, supportsTraversal: false, description: 'A baseline number, a baseline name, or $currentBaseline.' },
  { name: 'document', kind: 'id', qualifier: 'none', operators: ['=', '!=', '~'], supportsIn: true, supportsTraversal: false, description: 'The document that defines the requirement.' },
  { name: 'documenthistory', kind: 'id', qualifier: 'none', operators: ['=', '!=', '~'], supportsIn: true, supportsTraversal: false, description: 'Any version of that document.' },
  { name: 'links', kind: 'id', qualifier: 'none', operators: ['=', '!=', '~'], supportsIn: true, supportsTraversal: false, description: 'Documents where the requirement is defined or cited.' },
  { name: 'page', kind: 'id', qualifier: 'none', operators: ['=', '!=', '~'], supportsIn: true, supportsTraversal: false, deprecatedFor: 'document', description: 'Deprecated alias of document (RD-002).' },
  { name: 'pagehistory', kind: 'id', qualifier: 'none', operators: ['=', '!=', '~'], supportsIn: true, supportsTraversal: false, deprecatedFor: 'documenthistory', description: 'Deprecated alias of documentHistory (RD-002).' },
  { name: 'property', kind: 'property', qualifier: 'required', operators: ORDERED_OPERATORS, supportsIn: true, supportsTraversal: false, description: 'An inline property, written @Name.' },
  { name: 'ext', kind: 'property', qualifier: 'required', operators: ORDERED_OPERATORS, supportsIn: true, supportsTraversal: false, description: 'An external property, written ext@Name.' },
  { name: 'to', kind: 'dependency', qualifier: 'optional', operators: ['=', '!=', '~'], supportsIn: true, supportsTraversal: true, description: 'Dependencies from this requirement to its parents.' },
  { name: 'parent', kind: 'dependency', qualifier: 'optional', operators: ['=', '!=', '~'], supportsIn: true, supportsTraversal: true, description: 'Synonym of to.' },
  { name: 'from', kind: 'dependency', qualifier: 'optional', operators: ['=', '!=', '~'], supportsIn: true, supportsTraversal: true, description: 'Dependencies from this requirement to its children.' },
  { name: 'child', kind: 'dependency', qualifier: 'optional', operators: ['=', '!=', '~'], supportsIn: true, supportsTraversal: true, description: 'Synonym of from.' },
  { name: 'rulestatus', kind: 'enum', qualifier: 'optional', operators: ['=', '!='], supportsIn: true, supportsTraversal: false, enumValues: ['true', 'false', 'warning'], description: 'Requirement-type validation status.' },
  { name: 'type', kind: 'string', qualifier: 'none', operators: STRING_OPERATORS, supportsIn: true, supportsTraversal: false, description: 'The requirement type name.' },
  { name: 'label', kind: 'string', qualifier: 'none', operators: STRING_OPERATORS, supportsIn: true, supportsTraversal: false, description: 'A requirement label (RD-008).' },
];

const BY_NAME = new Map(FIELDS.map((field) => [field.name, field]));

export function findField(name: string): FieldSpec | undefined {
  return BY_NAME.get(name.toLowerCase());
}

/** spec: 02 §4 / RD-022 — Atlassian-specific fields get an explanation, not a guess. */
export const NOT_IMPLEMENTED_FIELDS: Readonly<Record<string, string>> = {
  jira: 'Jira fields are not supported. Integration links will introduce a generic externalLink field (RD-022).',
  project: 'project is Atlassian-specific and is not supported (RD-022).',
  projectname: 'projectName is Atlassian-specific and is not supported (RD-022).',
  excel: 'excel belongs to an import path Reqforge has not built (RD-022).',
  variant: 'Variants are deferred (RD-009); the field name is reserved.',
};

/** spec: 02 §6 — functions in predicate position. */
export const PREDICATE_FUNCTIONS: Readonly<Record<string, { arity: [number, number]; implemented: boolean; note?: string }>> = {
  ismodified: { arity: [1, 1], implemented: true },
  hastest: { arity: [0, 4], implemented: false, note: 'hasTest requires the testing module, which is not part of v1.' },
  haslasttest: { arity: [0, 4], implemented: false, note: 'hasLastTest requires the testing module, which is not part of v1.' },
};

export const VALUE_FUNCTIONS: Readonly<Record<string, { arity: [number, number] }>> = {
  user: { arity: [1, 1] },
};

export const KNOWN_FIELD_NAMES: readonly string[] = FIELDS.filter((field) => !field.deprecatedFor).map(
  (field) => field.name,
);

/** spec: 02 §5.1 / RD-021 — traversal chains are capped at four hops. */
export const MAX_TRAVERSAL_DEPTH = 4;
