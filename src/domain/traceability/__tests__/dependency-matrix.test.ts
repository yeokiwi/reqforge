import { describe, expect, it } from 'vitest';
import {
  AXIS_CAP,
  CELL_CAP,
  buildGrid,
  buildLegend,
  capRefusalFor,
  cellInitials,
  cellOf,
  emptyQueryRefusal,
  initialsOf,
  toGridSheets,
} from '../dependency-matrix';

const axis = [
  { key: 'BR-01', title: 'The business shall record every access' },
  { key: 'FN-01', title: 'The system shall log every access' },
  { key: 'FN-02', title: 'The system shall rotate keys' },
];

describe('the cap (spec 04 §3)', () => {
  it('refuses over 200 rows and offers the export rather than failing', () => {
    expect(capRefusalFor(AXIS_CAP)).toBeNull();

    const refusal = capRefusalFor(201);
    expect(refusal).toMatchObject({ refused: true, reason: 'over-cap', population: 201, cellCap: CELL_CAP });
    // The message names the numbers, as spec 07 §4 requires of a limit.
    expect(refusal!.message).toContain('201');
    expect(refusal!.message).toContain('40000');
    expect(refusal!.message).toContain('export');
  });

  it('refuses an empty query, which is RY own advice (research §4.3)', () => {
    expect(emptyQueryRefusal()).toMatchObject({ refused: true, reason: 'empty-query' });
  });
});

describe('the grid (invariant P1 at grid level)', () => {
  const edges = [
    { fromKey: 'FN-01', toKey: 'BR-01', relationship: 'Refines' },
    { fromKey: 'FN-01', toKey: 'BR-01', relationship: 'Verifies' },
    { fromKey: 'FN-02', toKey: 'BR-01', relationship: 'Refines' },
    // An edge leaving the population is not part of this grid.
    { fromKey: 'FN-01', toKey: 'OUT-99', relationship: 'Refines' },
  ];

  it('reads row-as-child → column-as-parent', () => {
    const grid = buildGrid(axis, edges);

    expect(cellOf(grid, 'FN-01', 'BR-01')).toEqual(['Refines', 'Verifies']);
    // Not the other way round: BR-01 is the parent, so its row is empty.
    expect(cellOf(grid, 'BR-01', 'FN-01')).toEqual([]);
  });

  it('drops edges pointing outside the population', () => {
    const grid = buildGrid(axis, edges);
    expect([...grid.cells.keys()].some((key) => key.includes('OUT-99'))).toBe(false);
  });

  it('never repeats a relationship in one cell', () => {
    const grid = buildGrid(axis, [...edges, { fromKey: 'FN-01', toKey: 'BR-01', relationship: 'Refines' }]);
    expect(cellOf(grid, 'FN-01', 'BR-01')).toEqual(['Refines', 'Verifies']);
  });
});

describe('initials and the legend', () => {
  it('abbreviates one word to two letters and several to their initials', () => {
    expect(initialsOf('Refines')).toBe('RE');
    expect(initialsOf('Is verified by')).toBe('IVB');
    expect(initialsOf('is_verified_by')).toBe('IVB');
    expect(initialsOf('   ')).toBe('?');
  });

  it('disambiguates relationships that would share initials', () => {
    const legend = buildLegend(['Refines', 'Requires', 'Verifies']);
    expect(legend).toEqual([
      { initials: 'RE', relationship: 'Refines' },
      { initials: 'RE2', relationship: 'Requires' },
      { initials: 'VE', relationship: 'Verifies' },
    ]);
  });

  it('renders a cell with the same glyphs the legend maps back', () => {
    const grid = buildGrid(axis, [
      { fromKey: 'FN-01', toKey: 'BR-01', relationship: 'Refines' },
      { fromKey: 'FN-01', toKey: 'BR-01', relationship: 'Requires' },
    ]);
    expect(cellInitials(grid, 'FN-01', 'BR-01')).toBe('RE RE2');
    expect(cellInitials(grid, 'FN-02', 'BR-01')).toBe('');
  });
});

describe('the export sheets (spec 04 §3)', () => {
  it('writes the grid on one sheet and the legend plus requirement list on the other', () => {
    const grid = buildGrid(axis, [{ fromKey: 'FN-01', toKey: 'BR-01', relationship: 'Refines' }]);
    const [matrix, legend] = toGridSheets(grid, new Map([['FN-01', 'Interfaces']]));

    expect(matrix!.name).toBe('Matrix');
    expect(matrix!.rows[0]).toEqual(['', 'BR-01', 'FN-01', 'FN-02']);
    expect(matrix!.rows[2]).toEqual(['FN-01', 'RE', '', '']);

    expect(legend!.name).toBe('Legend');
    expect(legend!.rows[0]).toEqual(['Initials', 'Relationship']);
    expect(legend!.rows[1]).toEqual(['RE', 'Refines']);
    expect(legend!.rows).toContainEqual(['FN-01', 'The system shall log every access', 'Interfaces']);
  });
});
