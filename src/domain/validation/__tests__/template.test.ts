import { describe, expect, it } from 'vitest';
import type { PMNode } from '@/domain/doc';
import { orderedColumns, parseTemplateColumns, tableIsEmpty, templateDocument, templateTable } from '../template';

/** spec: 03-authoring-and-indexing.md §6; 06-requirement-types.md §3 */

const para = (text?: string): PMNode =>
  text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' };
const td = (...content: PMNode[]): PMNode => ({ type: 'tableCell', content: content.length ? content : [para()] });
const th = (...content: PMNode[]): PMNode => ({ type: 'tableHeader', content: content.length ? content : [para()] });
const row = (...cells: PMNode[]): PMNode => ({ type: 'tableRow', content: cells });
const table = (...rows: PMNode[]): PMNode => ({ type: 'table', content: rows });

const columns = [
  { name: 'Rationale', required: false, ordinal: 1 },
  { name: 'Priority', required: true, ordinal: 2 },
  { name: 'Title', required: true, ordinal: 0 },
];

describe('orderedColumns', () => {
  it('puts required columns first, then the author ordinal', () => {
    expect(orderedColumns(columns).map((column) => column.name)).toEqual(['Title', 'Priority', 'Rationale']);
  });

  it('breaks a tie by name, so the order is stable', () => {
    const tied = [
      { name: 'Beta', required: true, ordinal: 0 },
      { name: 'Alpha', required: true, ordinal: 0 },
    ];
    expect(orderedColumns(tied).map((column) => column.name)).toEqual(['Alpha', 'Beta']);
  });

  it('does not mutate its input', () => {
    const input = [...columns];
    orderedColumns(input);
    expect(input.map((column) => column.name)).toEqual(['Rationale', 'Priority', 'Title']);
  });
});

describe('tableIsEmpty', () => {
  it('is true for a table of blank cells', () => {
    expect(tableIsEmpty(table(row(th(), th()), row(td(), td())))).toBe(true);
  });

  it('is true when a cell holds only whitespace', () => {
    expect(tableIsEmpty(table(row(td(para('   ')), td())))).toBe(true);
  });

  it('is false once a cell has text', () => {
    expect(tableIsEmpty(table(row(th(para('Title')), th()), row(td(), td())))).toBe(false);
  });

  it('is false when a cell holds a marker, a link, a report or a matrix', () => {
    for (const type of ['requirement', 'requirementLink', 'report', 'savedMatrix']) {
      const cell = td({ type: 'paragraph', content: [{ type, attrs: { key: 'FN-001' } }] });
      expect(tableIsEmpty(table(row(cell))), type).toBe(false);
    }
  });
});

describe('templateTable', () => {
  it('scaffolds a header row and one empty body row, required first', () => {
    const scaffold = templateTable(columns)!;
    const [header, body] = scaffold.content as PMNode[];

    expect(header!.content?.map((cell) => cell.type)).toEqual(['tableHeader', 'tableHeader', 'tableHeader']);
    expect(header!.content?.map((cell) => cell.content?.[0]?.content?.[0]?.text)).toEqual([
      'Title',
      'Priority',
      'Rationale',
    ]);
    expect(body!.content?.every((cell) => cell.type === 'tableCell')).toBe(true);
  });

  it('is empty by its own definition, so inserting into it is idempotent', () => {
    // A scaffolded table carries header text, so it is no longer "empty" — a second
    // insertion must not scaffold on top of the first (spec 03 §6).
    expect(tableIsEmpty(templateTable(columns)!)).toBe(false);
  });

  it('scaffolds nothing for a type with no template columns', () => {
    expect(templateTable([])).toBeNull();
  });
});

describe('templateDocument', () => {
  it('is a document holding one correctly-shaped table (spec 06 §3)', () => {
    const document = templateDocument(columns);
    expect(document.type).toBe('doc');
    expect(document.content?.map((node) => node.type)).toEqual(['paragraph', 'table', 'paragraph']);
  });

  it('is a plain empty document when the type has no columns', () => {
    expect(templateDocument([]).content?.map((node) => node.type)).toEqual(['paragraph']);
  });
});

describe('parseTemplateColumns', () => {
  it('narrows stored rows and drops unusable ones', () => {
    expect(
      parseTemplateColumns([
        { name: ' Priority ', required: true, ordinal: 2 },
        { name: '', required: true, ordinal: 0 },
        null,
      ]),
    ).toEqual([{ name: 'Priority', required: true, ordinal: 2 }]);
    expect(parseTemplateColumns('nope')).toEqual([]);
  });
});
