import type { DependencyDirection } from './dependencies';

/**
 * The dependency matrix: a genuine requirement × requirement grid, unlike the
 * traceability matrix (spec 04 §1, research §4.2–4.3).
 *
 * Both axes are the result set of one query, ordered by key. A cell holds the set of
 * relationship names linking **row-as-child → column-as-parent** (invariant P1).
 * spec: 04-traceability-and-coverage.md §3
 */
export const AXIS_CAP = 200;
export const CELL_CAP = 40_000;

/** research §4.3 — RY's export was tested at 5000 × 5000; beyond that we refuse by name. */
export const EXPORT_AXIS_CAP = 5_000;

export type GridEdge = { fromKey: string; toKey: string; relationship: string };

export type GridAxisEntry = { key: string; title: string };

export type Grid = {
  axis: GridAxisEntry[];
  /** `${fromKey}\u0000${toKey}` → relationship names, in stable order. */
  cells: Map<string, string[]>;
  legend: LegendEntry[];
};

export type LegendEntry = { initials: string; relationship: string };

export type CapRefusal = {
  refused: true;
  reason: 'over-cap' | 'empty-query';
  population: number;
  axisCap: number;
  cellCap: number;
  message: string;
};

export function cellKey(fromKey: string, toKey: string): string {
  return `${fromKey}\u0000${toKey}`;
}

/**
 * spec 04 §3 — "Web view cap: 40,000 cells (200 × 200) … Over the cap, the UI refuses and
 * offers the export instead." The refusal is a value, not an exception: the screen shows
 * it next to an Export button.
 */
export function capRefusalFor(population: number): CapRefusal | null {
  if (population <= AXIS_CAP) return null;
  return {
    refused: true,
    reason: 'over-cap',
    population,
    axisCap: AXIS_CAP,
    cellCap: CELL_CAP,
    message: `That query matches ${population} requirements, which would be ${population * population} cells. The grid is capped at ${CELL_CAP} (${AXIS_CAP} × ${AXIS_CAP}). Narrow the query, or export the full matrix.`,
  };
}

export function emptyQueryRefusal(): CapRefusal {
  return {
    refused: true,
    reason: 'empty-query',
    population: 0,
    axisCap: AXIS_CAP,
    cellCap: CELL_CAP,
    // research §4.3 — RY's own advice is never to run these screens with an empty query.
    message: 'The dependency matrix needs a query. Running it over every requirement is what makes this screen expensive.',
  };
}

/**
 * Initials for a relationship name, with the full name kept for the tooltip and the
 * legend. Two relationships that would share initials are disambiguated by a numeric
 * suffix, so the legend is always readable back.
 */
export function buildLegend(relationships: readonly string[]): LegendEntry[] {
  const used = new Map<string, number>();

  return [...new Set(relationships)]
    .sort((a, b) => a.localeCompare(b))
    .map((relationship) => {
      const base = initialsOf(relationship);
      const seen = used.get(base) ?? 0;
      used.set(base, seen + 1);
      return { initials: seen === 0 ? base : `${base}${seen + 1}`, relationship };
    });
}

export function initialsOf(relationship: string): string {
  const words = relationship.trim().split(/[\s_-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return words
    .slice(0, 3)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}

/** Builds the grid from the population and the edges *within* it. */
export function buildGrid(axis: readonly GridAxisEntry[], edges: readonly GridEdge[]): Grid {
  const present = new Set(axis.map((entry) => entry.key));
  const cells = new Map<string, string[]>();

  for (const edge of edges) {
    // An edge leaving the population is not part of this grid.
    if (!present.has(edge.fromKey) || !present.has(edge.toKey)) continue;

    const id = cellKey(edge.fromKey, edge.toKey);
    const existing = cells.get(id) ?? [];
    if (!existing.includes(edge.relationship)) {
      cells.set(id, [...existing, edge.relationship].sort((a, b) => a.localeCompare(b)));
    }
  }

  return {
    axis: [...axis],
    cells,
    legend: buildLegend(edges.map((edge) => edge.relationship)),
  };
}

export function cellOf(grid: Grid, fromKey: string, toKey: string): string[] {
  return grid.cells.get(cellKey(fromKey, toKey)) ?? [];
}

/** Renders a cell as initials, using the grid's legend so the glyphs match. */
export function cellInitials(grid: Grid, fromKey: string, toKey: string): string {
  const byName = new Map(grid.legend.map((entry) => [entry.relationship, entry.initials]));
  return cellOf(grid, fromKey, toKey)
    .map((relationship) => byName.get(relationship) ?? initialsOf(relationship))
    .join(' ');
}

export type GridSheet = { name: string; rows: string[][] };

/**
 * The two sheets of the xlsx export (spec 04 §3): the grid, and a legend plus the
 * requirement list. Shaped here so the export and the screen cannot disagree.
 */
export function toGridSheets(grid: Grid, documentTitles: ReadonlyMap<string, string>): GridSheet[] {
  const header = ['', ...grid.axis.map((entry) => entry.key)];
  const rows = grid.axis.map((row) => [
    row.key,
    ...grid.axis.map((column) => cellInitials(grid, row.key, column.key)),
  ]);

  return [
    { name: 'Matrix', rows: [header, ...rows] },
    {
      name: 'Legend',
      rows: [
        ['Initials', 'Relationship'],
        ...grid.legend.map((entry) => [entry.initials, entry.relationship]),
        [],
        ['Key', 'Title', 'Document'],
        ...grid.axis.map((entry) => [entry.key, entry.title, documentTitles.get(entry.key) ?? '']),
      ],
    },
  ];
}

/** The direction a grid reads, spelled out where the UI needs to say it. */
export const GRID_DIRECTION: DependencyDirection = 'to';
