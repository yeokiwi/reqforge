import { MAX_TRAVERSAL_DEPTH } from '@/domain/ryql/fields';
import type { DependencyDirection } from './dependencies';

/**
 * The traceability matrix: one row per requirement, configurable columns.
 * spec: 04-traceability-and-coverage.md §2.1
 *
 * It is deliberately **not** a two-axis grid — research §4.2 names that as the most
 * commonly misread mechanic. The grid is the dependency matrix (spec 04 §3).
 */
export type Aggregate = 'sum' | 'min' | 'max' | 'avg' | 'count';

export type DependencyRender = 'key' | 'key+title' | 'count';

export type MatrixColumn =
  | { kind: 'key' }
  | { kind: 'title' }
  | { kind: 'document' }
  | { kind: 'status' }
  | { kind: 'property'; name: string }
  | { kind: 'external'; name: string; editable: boolean; aggregate?: Aggregate }
  | {
      kind: 'dependency';
      direction: DependencyDirection;
      relationship?: string;
      depth: 1 | 2 | 3 | 4;
      render: DependencyRender;
    }
  | { kind: 'ruleStatus'; typeId?: string };

export type MatrixConfig = {
  query: string;
  columns: MatrixColumn[];
  pageSize: number;
  treeView: boolean;
};

/** spec: 07-permissions-and-limits.md §4 — matrix page size, 100 default and 600 max. */
export const PAGE_SIZE_DEFAULT = 100;
export const PAGE_SIZE_MAX = 600;

export const DEFAULT_COLUMNS: MatrixColumn[] = [{ kind: 'key' }, { kind: 'title' }, { kind: 'status' }];

const COLUMN_KINDS = new Set([
  'key',
  'title',
  'document',
  'status',
  'property',
  'external',
  'dependency',
  'ruleStatus',
]);

const AGGREGATES = new Set<Aggregate>(['sum', 'min', 'max', 'avg', 'count']);
const RENDERS = new Set<DependencyRender>(['key', 'key+title', 'count']);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Normalises one column. `SavedMatrix.columns` is JSON written by an earlier build or by
 * the API, so nothing here may be trusted: an unusable column is dropped rather than
 * allowed to reach the SQL builders.
 */
export function parseMatrixColumn(value: unknown): MatrixColumn | null {
  const record = asRecord(value);
  const kind = record ? asString(record.kind) : null;
  if (!record || !kind || !COLUMN_KINDS.has(kind)) return null;

  switch (kind) {
    case 'key':
    case 'title':
    case 'document':
    case 'status':
      return { kind };

    case 'property': {
      const name = asString(record.name);
      return name ? { kind: 'property', name } : null;
    }

    case 'external': {
      const name = asString(record.name);
      if (!name) return null;
      const aggregate = asString(record.aggregate) as Aggregate | null;
      return {
        kind: 'external',
        name,
        // spec 04 §2.2 — an editable column becomes an input in the matrix's edit mode.
        editable: record.editable === true,
        ...(aggregate && AGGREGATES.has(aggregate) ? { aggregate } : {}),
      };
    }

    case 'dependency': {
      const direction = asString(record.direction);
      if (direction !== 'to' && direction !== 'from') return null;
      const render = asString(record.render) as DependencyRender | null;
      const relationship = asString(record.relationship);
      return {
        kind: 'dependency',
        direction,
        ...(relationship ? { relationship } : {}),
        // RD-021: traversal is capped at four hops, here as everywhere else.
        depth: clampDepth(record.depth),
        render: render && RENDERS.has(render) ? render : 'key',
      };
    }

    case 'ruleStatus': {
      const typeId = asString(record.typeId);
      return { kind: 'ruleStatus', ...(typeId ? { typeId } : {}) };
    }

    default:
      return null;
  }
}

function clampDepth(value: unknown): 1 | 2 | 3 | 4 {
  const depth = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 1;
  const bounded = Math.min(Math.max(depth, 1), MAX_TRAVERSAL_DEPTH);
  return bounded as 1 | 2 | 3 | 4;
}

export function parseMatrixColumns(value: unknown): MatrixColumn[] {
  if (!Array.isArray(value)) return [...DEFAULT_COLUMNS];
  const columns = value.map(parseMatrixColumn).filter((column): column is MatrixColumn => column !== null);
  return columns.length > 0 ? columns : [...DEFAULT_COLUMNS];
}

export function parseMatrixConfig(value: unknown): MatrixConfig {
  const record = asRecord(value) ?? {};
  const pageSize =
    typeof record.pageSize === 'number' && Number.isFinite(record.pageSize)
      ? Math.trunc(record.pageSize)
      : PAGE_SIZE_DEFAULT;

  return {
    query: asString(record.query) ?? '',
    columns: parseMatrixColumns(record.columns),
    pageSize: Math.min(Math.max(pageSize, 1), PAGE_SIZE_MAX),
    treeView: record.treeView === true,
  };
}

/** Stable identity of a column within a config — the key the fetched cells are filed under. */
export function columnId(column: MatrixColumn): string {
  switch (column.kind) {
    case 'property':
    case 'external':
      return `${column.kind}:${column.name.toLowerCase()}`;
    case 'dependency':
      return `dependency:${column.direction}:${column.relationship ?? '*'}:${column.depth}:${column.render}`;
    case 'ruleStatus':
      return `ruleStatus:${column.typeId ?? '*'}`;
    default:
      return column.kind;
  }
}

export function columnLabel(column: MatrixColumn): string {
  switch (column.kind) {
    case 'key':
      return 'Key';
    case 'title':
      return 'Title';
    case 'document':
      return 'Document';
    case 'status':
      return 'Status';
    case 'property':
      return column.name;
    case 'external':
      return `${column.name} *`;
    case 'dependency': {
      const direction = column.direction === 'to' ? 'Depends on' : 'Depended on by';
      const relationship = column.relationship ? ` — ${column.relationship}` : '';
      const depth = column.depth > 1 ? ` (depth ${column.depth})` : '';
      const count = column.render === 'count' ? ' count' : '';
      return `${direction}${relationship}${depth}${count}`;
    }
    case 'ruleStatus':
      return column.typeId ? `Rule status (${column.typeId})` : 'Rule status';
  }
}

export type MatrixCell = { text: string; keys?: string[]; count?: number };

export type MatrixRow = {
  id: string;
  key: string;
  spaceKey: string | null;
  documentId: string | null;
  documentTitle: string | null;
  cells: Record<string, MatrixCell>;
};

export type MatrixPage = {
  config: MatrixConfig;
  rows: MatrixRow[];
  total: number;
  offset: number;
};

export type DocumentGroup = { documentId: string | null; documentTitle: string; rows: MatrixRow[] };

/**
 * The tree view: rows grouped by the document that defines them.
 * spec: 04-traceability-and-coverage.md §2.1 (`treeView`), research §4.2
 */
export function groupRowsByDocument(rows: readonly MatrixRow[]): DocumentGroup[] {
  const groups = new Map<string, DocumentGroup>();

  for (const row of rows) {
    const id = row.documentId ?? '';
    const group = groups.get(id) ?? {
      documentId: row.documentId,
      documentTitle: row.documentTitle ?? 'No defining document',
      rows: [],
    };
    group.rows.push(row);
    groups.set(id, group);
  }

  return [...groups.values()].sort((a, b) => a.documentTitle.localeCompare(b.documentTitle));
}

/**
 * The flat cell matrix the xlsx export writes. The screen and the export read the same
 * function, so a cell cannot mean two different things in the two places.
 */
export function toSheetRows(config: MatrixConfig, rows: readonly MatrixRow[]): string[][] {
  const header = config.columns.map(columnLabel);
  const body = rows.map((row) =>
    config.columns.map((column) => row.cells[columnId(column)]?.text ?? ''),
  );
  return [header, ...body];
}
