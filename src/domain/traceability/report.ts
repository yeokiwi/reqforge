import { childrenOf, type PMNode } from '@/domain/doc';

/**
 * The report macro: a query, a columns spec, and three switches.
 * spec: 04-traceability-and-coverage.md §5 (research §4.5)
 */
export type ReportConfig = {
  query: string;
  columns: string;
  countOnly: boolean;
  useLastRequirement: boolean;
  useLastRequirementDefinition: boolean;
};

export const DEFAULT_COLUMNS = 'key, description+properties, links';

export type FieldName = 'key' | 'description' | 'properties' | 'status' | 'original' | 'links' | 'to' | 'from';

export type FieldFormat = 'short' | 'page';
export type ListMode = 'true' | 'false' | 'last';

export type ReportField = {
  name: FieldName;
  relationship: string | null;
  format: FieldFormat;
  li: ListMode;
  duplicates: boolean;
};

export type ReportColumn = { fields: ReportField[]; label: string };

export type ReportProblem = { source: string; message: string };

const FIELDS = new Set<FieldName>([
  'key',
  'description',
  'properties',
  'status',
  'original',
  'links',
  'to',
  'from',
]);

/** Not implemented, with an explanation rather than a silent drop — as `RD-022` does. */
const REFUSED: Readonly<Record<string, string>> = {
  jira: 'jira is Atlassian-specific and is not supported (RD-022).',
  tests: 'tests needs the testing module, which is not part of v1.',
};

const FIELD_LABELS: Readonly<Record<FieldName, string>> = {
  key: 'Key',
  description: 'Description',
  properties: 'Properties',
  status: 'Status',
  original: 'Description',
  links: 'Documents',
  to: 'Depends on',
  from: 'Depended on by',
};

/**
 * `<field>[@<relationship>][?opt=val&…]`, `+` joins fields into one column, `,` separates
 * columns. spec: 04 §5 — kept compatible with RY so pasted column specs work.
 */
export function parseColumns(spec: string): { columns: ReportColumn[]; problems: ReportProblem[] } {
  const source = spec.trim().length === 0 ? DEFAULT_COLUMNS : spec;
  const problems: ReportProblem[] = [];

  const columns = source
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const fields = part
        .split('+')
        .map((piece) => piece.trim())
        .filter((piece) => piece.length > 0)
        .map((piece) => parseField(piece, problems))
        .filter((field): field is ReportField => field !== null);

      return fields.length === 0 ? null : { fields, label: fields.map(labelOf).join(' + ') };
    })
    .filter((column): column is ReportColumn => column !== null);

  // A spec whose every column was unusable falls back to the default, so a typo never
  // leaves a reader with a blank report and no explanation.
  if (columns.length === 0) {
    return { columns: parseColumns(DEFAULT_COLUMNS).columns, problems };
  }

  return { columns, problems };
}

function labelOf(field: ReportField): string {
  const base = FIELD_LABELS[field.name];
  return field.relationship ? `${base} — ${field.relationship}` : base;
}

function parseField(source: string, problems: ReportProblem[]): ReportField | null {
  const [head, rawOptions = ''] = source.split('?');
  const [rawName = '', relationship] = head!.split('@');
  const name = rawName.trim().toLowerCase();

  const refusal = REFUSED[name];
  if (refusal) {
    problems.push({ source, message: refusal });
    return null;
  }
  if (!FIELDS.has(name as FieldName)) {
    problems.push({ source, message: `Unknown field "${rawName.trim()}". Known fields: ${[...FIELDS].join(', ')}.` });
    return null;
  }

  const options = new URLSearchParams(rawOptions);
  const format = options.get('format');
  const li = options.get('li');

  if (format !== null && format !== 'short' && format !== 'page') {
    problems.push({ source, message: `format must be short or page, not "${format}".` });
  }
  if (li !== null && li !== 'true' && li !== 'false' && li !== 'last') {
    problems.push({ source, message: `li must be true, false or last, not "${li}".` });
  }

  return {
    name: name as FieldName,
    relationship: relationship?.trim() ? relationship.trim() : null,
    format: format === 'page' ? 'page' : 'short',
    li: li === 'true' || li === 'last' ? li : 'false',
    // `duplicates=false` removes repeats; anything else keeps them.
    duplicates: options.get('duplicates') !== 'false',
  };
}

// ---------------------------------------------------------------- rendering

export type ReportValue = { text: string; href?: string };

export type ReportSource = {
  key: string;
  title: string;
  bodyHtml: string;
  status: string;
  properties: Array<{ name: string; value: string }>;
  documents: Array<{ id: string; title: string }>;
  dependencies: Array<{ direction: 'to' | 'from'; relationship: string; key: string; title: string }>;
};

export type ReportCell = { values: ReportValue[]; li: ListMode };

export type ReportRow = { key: string; cells: ReportCell[] };

/**
 * Shapes the fetched rows into cells. The node view and anything else that renders a
 * report read this, so a cell cannot mean two things in two places.
 */
export function renderReportRows(columns: readonly ReportColumn[], sources: readonly ReportSource[]): ReportRow[] {
  return sources.map((source) => ({
    key: source.key,
    cells: columns.map((column) => {
      const values = column.fields.flatMap((field) => valuesFor(field, source));
      const deduped = dedupe(column, values);
      const li = column.fields[0]?.li ?? 'false';
      return { values: li === 'last' ? deduped.slice(-1) : deduped, li };
    }),
  }));
}

function dedupe(column: ReportColumn, values: ReportValue[]): ReportValue[] {
  if (column.fields.every((field) => field.duplicates)) return values;

  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.text)) return false;
    seen.add(value.text);
    return true;
  });
}

function valuesFor(field: ReportField, source: ReportSource): ReportValue[] {
  switch (field.name) {
    case 'key':
      return [{ text: source.key }];

    case 'status':
      return [{ text: source.status }];

    case 'description':
    case 'original':
      // RD-034: `original` is `description` resolved against the defining occurrence,
      // which in Reqforge is the same text — the requirement table is a projection of
      // that document version (overview, decision 2).
      return [{ text: source.title }];

    case 'properties':
      return source.properties.map((property) => ({ text: `${property.name}: ${property.value}` }));

    case 'links':
      return source.documents.map((document) => ({
        text: field.format === 'page' ? document.title : document.id,
        href: `#document:${document.id}`,
      }));

    case 'to':
    case 'from':
      return source.dependencies
        .filter((edge) => edge.direction === field.name)
        .filter((edge) => field.relationship === null || edge.relationship === field.relationship)
        .map((edge) => ({
          text: field.format === 'page' ? `${edge.key} — ${edge.title}` : edge.key,
          href: `#requirement:${edge.key}`,
        }));
  }
}

// ---------------------------------------------------------------- last requirement

export type LastRequirementMode = 'query' | 'last' | 'lastDefinition';

export function modeOf(config: Pick<ReportConfig, 'useLastRequirement' | 'useLastRequirementDefinition'>): LastRequirementMode {
  // spec 04 §5 — the definition switch overrides the other, and either ignores the query.
  if (config.useLastRequirementDefinition) return 'lastDefinition';
  return config.useLastRequirement ? 'last' : 'query';
}

/**
 * The requirement a report renders when it ignores its query.
 * spec: 04-traceability-and-coverage.md §5; research §4.5
 *
 * `last` takes the nearest preceding marker or link. `lastDefinition` takes the nearest
 * preceding **definition whose scope does not contain the report** — "the previous
 * definition", which is what avoids a report rendering the requirement it sits inside
 * (`RD-035`).
 */
export function resolveLastRequirement(
  content: PMNode,
  reportId: string,
  mode: LastRequirementMode,
): string | null {
  if (mode === 'query') return null;

  const found = collectInOrder(content, reportId);
  if (!found.reportSeen) return null;

  if (mode === 'last') return found.beforeReport.at(-1)?.key ?? null;

  // The definitions before the report, minus the one whose scope contains it.
  const enclosing = found.enclosingDefinitionKey;
  const definitions = found.beforeReport.filter((entry) => entry.kind === 'requirement');
  const candidates = enclosing === null ? definitions : definitions.filter((entry) => entry.key !== enclosing);

  return candidates.at(-1)?.key ?? null;
}

type FoundEntry = { kind: 'requirement' | 'requirementLink'; key: string };

/**
 * Walks the document once, collecting the markers before the report and noting which
 * definition (if any) shares a block with it — the report's enclosing scope.
 */
function collectInOrder(
  root: PMNode,
  reportId: string,
): { beforeReport: FoundEntry[]; reportSeen: boolean; enclosingDefinitionKey: string | null } {
  const beforeReport: FoundEntry[] = [];
  let reportSeen = false;
  let enclosingDefinitionKey: string | null = null;

  const visit = (node: PMNode, scopeDefinition: string | null): void => {
    if (reportSeen) return;

    if (node.type === 'report') {
      if (node.attrs?.id === reportId) {
        reportSeen = true;
        enclosingDefinitionKey = scopeDefinition;
      }
      return;
    }

    if (node.type === 'requirement' || node.type === 'requirementLink') {
      const key = typeof node.attrs?.key === 'string' ? node.attrs.key : '';
      if (key.length > 0) beforeReport.push({ kind: node.type, key });
      return;
    }

    // A table row, a table column's cell or a block is a scope: a definition inside it
    // encloses anything else inside it (spec 03 §2).
    const scope = scopeOf(node) ? definitionIn(node) : scopeDefinition;
    for (const child of childrenOf(node)) visit(child, scope);
  };

  visit(root, null);
  return { beforeReport, reportSeen, enclosingDefinitionKey };
}

const SCOPE_TYPES = new Set(['tableRow', 'paragraph', 'listItem', 'heading', 'blockquote']);

function scopeOf(node: PMNode): boolean {
  return SCOPE_TYPES.has(node.type);
}

/** The first `requirement` marker inside a subtree, if any. */
function definitionIn(node: PMNode): string | null {
  if (node.type === 'requirement') {
    return typeof node.attrs?.key === 'string' ? node.attrs.key : null;
  }
  for (const child of childrenOf(node)) {
    const found = definitionIn(child);
    if (found !== null) return found;
  }
  return null;
}
