import { describe, expect, it } from 'vitest';
import {
  columnId,
  columnLabel,
  groupRowsByDocument,
  parseMatrixColumn,
  parseMatrixConfig,
  toSheetRows,
  type MatrixRow,
} from '../matrix';

describe('parsing a stored matrix config (spec 04 §2.1)', () => {
  it('keeps a well-formed config and defaults the rest', () => {
    const config = parseMatrixConfig({
      query: "key ~ 'FN-%'",
      columns: [{ kind: 'key' }, { kind: 'property', name: 'Category' }],
      pageSize: 50,
      treeView: true,
    });

    expect(config).toEqual({
      query: "key ~ 'FN-%'",
      columns: [{ kind: 'key' }, { kind: 'property', name: 'Category' }],
      pageSize: 50,
      treeView: true,
    });
  });

  it('clamps the page size to the spec 07 §4 limits', () => {
    expect(parseMatrixConfig({ pageSize: 5000 }).pageSize).toBe(600);
    expect(parseMatrixConfig({ pageSize: 0 }).pageSize).toBe(1);
    expect(parseMatrixConfig({}).pageSize).toBe(100);
  });

  it('clamps dependency depth to the traversal cap (RD-021)', () => {
    const column = parseMatrixColumn({ kind: 'dependency', direction: 'to', depth: 9, render: 'key' });
    expect(column).toMatchObject({ depth: 4 });
    expect(parseMatrixColumn({ kind: 'dependency', direction: 'from', depth: 0 })).toMatchObject({ depth: 1 });
  });

  it('drops columns it cannot use rather than passing them to the SQL builders', () => {
    expect(parseMatrixColumn({ kind: 'property' })).toBeNull();
    expect(parseMatrixColumn({ kind: 'external', name: '  ' })).toBeNull();
    expect(parseMatrixColumn({ kind: 'dependency', direction: 'sideways' })).toBeNull();
    expect(parseMatrixColumn({ kind: 'computed', expression: 'count(from@x)' })).toBeNull();
    expect(parseMatrixColumn('key')).toBeNull();

    // A config whose columns are all unusable falls back to the defaults.
    expect(parseMatrixConfig({ columns: [{ kind: 'nope' }] }).columns).toEqual([
      { kind: 'key' },
      { kind: 'title' },
      { kind: 'status' },
    ]);
  });

  it('normalises a dependency column and an external column', () => {
    expect(parseMatrixColumn({ kind: 'dependency', direction: 'to', relationship: 'Refines', depth: 2, render: 'count' })).toEqual({
      kind: 'dependency',
      direction: 'to',
      relationship: 'Refines',
      depth: 2,
      render: 'count',
    });
    expect(parseMatrixColumn({ kind: 'external', name: 'Approval', editable: true, aggregate: 'count' })).toEqual({
      kind: 'external',
      name: 'Approval',
      editable: true,
      aggregate: 'count',
    });
    expect(parseMatrixColumn({ kind: 'external', name: 'Approval', aggregate: 'median' })).toEqual({
      kind: 'external',
      name: 'Approval',
      editable: false,
    });
  });
});

describe('column identity and labels', () => {
  it('gives each configured column a stable id', () => {
    expect(columnId({ kind: 'key' })).toBe('key');
    expect(columnId({ kind: 'property', name: 'Category' })).toBe('property:category');
    expect(columnId({ kind: 'dependency', direction: 'to', relationship: 'Refines', depth: 2, render: 'key' })).toBe(
      'dependency:to:Refines:2:key',
    );
    // A bare dependency column is any relationship, and must not collide with a named one.
    expect(columnId({ kind: 'dependency', direction: 'to', depth: 1, render: 'key' })).toBe('dependency:to:*:1:key');
  });

  it('labels columns the way the screen and the export both show them', () => {
    expect(columnLabel({ kind: 'property', name: 'Category' })).toBe('Category');
    expect(columnLabel({ kind: 'external', name: 'Approval', editable: false })).toBe('Approval *');
    expect(columnLabel({ kind: 'dependency', direction: 'to', relationship: 'Refines', depth: 2, render: 'count' })).toBe(
      'Depends on — Refines (depth 2) count',
    );
    expect(columnLabel({ kind: 'dependency', direction: 'from', depth: 1, render: 'key' })).toBe('Depended on by');
  });
});

const row = (key: string, documentId: string | null, documentTitle: string | null): MatrixRow => ({
  id: `id-${key}`,
  key,
  spaceKey: null,
  documentId,
  documentTitle,
  cells: { key: { text: key }, title: { text: `Title of ${key}` } },
});

describe('tree view and sheet shaping', () => {
  it('groups rows by their defining document, alphabetically', () => {
    const groups = groupRowsByDocument([
      row('FN-01', 'doc-b', 'Interfaces'),
      row('BR-01', 'doc-a', 'Business rules'),
      row('FN-02', 'doc-b', 'Interfaces'),
      row('OR-01', null, null),
    ]);

    expect(groups.map((group) => group.documentTitle)).toEqual([
      'Business rules',
      'Interfaces',
      'No defining document',
    ]);
    expect(groups[1]!.rows.map((entry) => entry.key)).toEqual(['FN-01', 'FN-02']);
  });

  it('shapes the sheet from the same cells the screen renders', () => {
    const config = parseMatrixConfig({ query: '', columns: [{ kind: 'key' }, { kind: 'title' }] });
    expect(toSheetRows(config, [row('FN-01', 'doc-a', 'Spec')])).toEqual([
      ['Key', 'Title'],
      ['FN-01', 'Title of FN-01'],
    ]);
  });

  it('writes an empty cell rather than dropping a column when a row has no value', () => {
    const config = parseMatrixConfig({ columns: [{ kind: 'key' }, { kind: 'property', name: 'Category' }] });
    expect(toSheetRows(config, [row('FN-01', null, null)])).toEqual([
      ['Key', 'Category'],
      ['FN-01', ''],
    ]);
  });
});
