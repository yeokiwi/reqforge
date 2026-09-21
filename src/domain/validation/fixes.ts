import type { AnchorPath } from '@/domain/doc';
import type { RequirementLayout } from '@/domain/indexer/types';
import type { RuleDirection } from './rules';

/**
 * A quick fix, described as **data**.
 * spec: 06-requirement-types.md §4 — "Fixes are ProseMirror transactions and must be
 * individually undoable." `RD-042`: what the repair *is* is decided here, in a pure
 * function; turning it into a transaction is the editor's job. The alternative — the
 * editor re-deriving the repair from the diagnostic's code and message — would put spec
 * knowledge in two places and make every fix untestable without a browser.
 */
export type DiagnosticFix =
  /** Add a column (horizontal) or a row (vertical) named for the missing property. */
  | { kind: 'addColumn'; tablePath: AnchorPath; layout: RequirementLayout; name: string }
  /** Promote a table's first row to a header row — rule S4's repair. */
  | { kind: 'promoteHeader'; tablePath: AnchorPath }
  /** Replace a cell's contents with one of a fixed list of values. */
  | { kind: 'setCellValue'; cellPath: AnchorPath; name: string; values: string[] }
  /**
   * Open the link picker scoped to one relationship. `cellPath` is the cell the link
   * belongs in — the one under the header naming that relationship (spec 03 §1.2), so
   * the inserted link is read as that relationship and not as a plain `Dependency`.
   * It is null when the scope has no such column, and the author is told to add one.
   */
  | {
      kind: 'addDependency';
      anchorPath: AnchorPath;
      relationship: string;
      direction: RuleDirection;
      cellPath: AnchorPath | null;
    }
  /** Replace the marker's key with one the space's patterns allow. */
  | { kind: 'replaceKey'; anchorPath: AnchorPath; currentKey: string };

/** One field of a requirement's scope, as the fixes need to see it. */
export type PlacementCell = {
  name: string;
  searchName: string;
  /** The value cell for this field, when the scope has one. */
  valuePath: AnchorPath | null;
};

/**
 * Where a requirement sits in the document, which is everything a fix needs to know.
 * The indexer produces it — it already resolves the scope — so no fix re-parses the
 * document, and a validation run that has no document in hand (the revalidation job)
 * simply has no placement and offers no fixes.
 */
export type Placement = {
  layout: RequirementLayout;
  anchorPath: AnchorPath;
  table: { path: AnchorPath; row: number; column: number; hasHeader: boolean } | null;
  cells: readonly PlacementCell[];
};

export function addColumnFix(placement: Placement | null, name: string): DiagnosticFix | null {
  if (!placement?.table) return null;
  return { kind: 'addColumn', tablePath: placement.table.path, layout: placement.layout, name };
}

export function promoteHeaderFix(placement: Placement | null): DiagnosticFix | null {
  if (!placement?.table) return null;
  return { kind: 'promoteHeader', tablePath: placement.table.path };
}

export function setCellValueFix(
  placement: Placement | null,
  name: string,
  searchName: string,
  values: readonly string[],
): DiagnosticFix | null {
  const cell = placement?.cells.find((candidate) => candidate.searchName === searchName);
  if (!cell?.valuePath) return null;
  return { kind: 'setCellValue', cellPath: cell.valuePath, name, values: [...values] };
}

export function addDependencyFix(
  placement: Placement | null,
  relationship: string,
  direction: RuleDirection,
): DiagnosticFix | null {
  // A `from` rule is satisfied by an edge declared in *another* document: a link inserted
  // here would be outbound and would not satisfy it. Offering the picker would be a lie,
  // so there is no fix — the author is told what is missing and where it must come from.
  if (!placement || direction === 'from') return null;

  const cell = placement.cells.find(
    (candidate) => candidate.searchName === relationship.trim().toLowerCase(),
  );

  return {
    kind: 'addDependency',
    anchorPath: placement.anchorPath,
    relationship,
    direction,
    cellPath: cell?.valuePath ?? null,
  };
}

export function replaceKeyFix(anchorPath: AnchorPath, currentKey: string): DiagnosticFix {
  return { kind: 'replaceKey', anchorPath, currentKey };
}

/** What the fix button says. */
export function fixLabel(fix: DiagnosticFix): string {
  switch (fix.kind) {
    case 'addColumn':
      return fix.layout === 'VERTICAL_TABLE' ? `Add the ${fix.name} row` : `Add the ${fix.name} column`;
    case 'promoteHeader':
      return 'Make the first row a header';
    case 'setCellValue':
      return `Choose a ${fix.name}`;
    case 'addDependency':
      return fix.cellPath
        ? `Link a ${fix.relationship}`
        : `Link a ${fix.relationship} — add a ${fix.relationship} column first`;
    case 'replaceKey':
      return 'Use an allowed key';
  }
}
