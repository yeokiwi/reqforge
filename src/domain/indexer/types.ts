import type { AnchorPath, PMNode } from '@/domain/doc';
import type { DiagnosticFix, Placement } from '@/domain/validation/fixes';

/** spec: 03-authoring-and-indexing.md §7 — the diagnostics catalogue. */
export type DiagnosticCode =
  | 'DUPLICATE_MARKER_IN_SCOPE'
  | 'KEY_CONFLICT'
  | 'KEY_INVALID'
  | 'KEY_NOT_ALLOWED'
  | 'MISSING_REQUIRED_PROPERTY'
  | 'MISSING_REQUIRED_DEPENDENCY'
  | 'MISSING_OPTIONAL_PROPERTY'
  | 'TABLE_HAS_NO_HEADER'
  | 'UNRESOLVED_LINK'
  | 'PROPERTY_NAME_NOT_SEARCHABLE'
  | 'IMAGE_IN_REQUIREMENT'
  // RD-041 — spec 06 §4's fix table names PROPERTY_NOT_IN_VALUES, and a failing
  // PROPERTY_MATCHES rule had no code at all. Both are errors (spec 06 §2.1).
  | 'PROPERTY_NOT_IN_VALUES'
  | 'PROPERTY_DOES_NOT_MATCH';

export type DiagnosticSeverity = 'error' | 'warning';

export type Diagnostic = {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  /** Node position, so the editor can point at it. */
  path: AnchorPath;
  key?: string;
  /**
   * The repair, described as data, when one can be made mechanically (spec 06 §4).
   * `RD-042` — the editor turns it into a ProseMirror transaction; deciding *what* the
   * repair is stays in a pure function, so every fix is unit-tested.
   */
  fix?: DiagnosticFix;
};

/** spec: 03-authoring-and-indexing.md §2 — the three layouts. */
export type RequirementLayout = 'HORIZONTAL_TABLE' | 'VERTICAL_TABLE' | 'PARAGRAPH';

export type IndexedRequirement = {
  key: string;
  upperKey: string;
  uid: string;
  typeId: string | null;
  title: string;
  bodyHtml: string;
  bodySearch: string;
  anchorPath: AnchorPath;
  layout: RequirementLayout;
  /**
   * Where the requirement sits in the document, which is what a quick fix needs to know
   * (spec 06 §4). The indexer has already resolved the scope, so nothing re-parses the
   * document later.
   */
  placement: Placement;
};

export type IndexedProperty = {
  /** Owning requirement, by key within this document. */
  key: string;
  name: string;
  searchName: string;
  value: string;
  /** Column (or row) order, for display. */
  valueOrdinal: number;
  /** Member index within a list-valued cell. */
  valueIndex: number;
};

export type IndexedDependency = {
  childKey: string;
  relationship: string;
  targetSpaceKey: string;
  targetKey: string;
  targetBaselineNumber: number | null;
  path: AnchorPath;
};

/** A citation: a requirement mentioned outside any requirement's scope (origin = false). */
export type IndexedLink = {
  targetSpaceKey: string;
  targetKey: string;
  path: AnchorPath;
};

export type IndexResult = {
  requirements: IndexedRequirement[];
  properties: IndexedProperty[];
  dependencies: IndexedDependency[];
  links: IndexedLink[];
  diagnostics: Diagnostic[];
};

/** A requirement type, reduced to what indexing needs. spec: 06-requirement-types.md §1 */
export type SpaceTypeConfig = {
  id: string;
  name: string | null;
  keyPattern: string;
  /** spec: 03 §4.3 — with any type locked, a key matching no configured pattern is refused. */
  locked: boolean;
};

/** Everything the indexer needs beyond the document itself. It reads no database. */
export type SpaceConfig = {
  key: string;
  types?: readonly SpaceTypeConfig[];
};

export type IndexInput = {
  content: PMNode;
  space: SpaceConfig;
};
