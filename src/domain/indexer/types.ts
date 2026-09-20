import type { AnchorPath, PMNode } from '@/domain/doc';

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
  | 'IMAGE_IN_REQUIREMENT';

export type DiagnosticSeverity = 'error' | 'warning';

export type Diagnostic = {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  /** Node position, so the editor can point at it. */
  path: AnchorPath;
  key?: string;
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

/** Everything the indexer needs beyond the document itself. It reads no database. */
export type SpaceConfig = {
  key: string;
  /** spec: 03 §4.3 — when set, keys matching no configured pattern are refused. */
  lockedKeyPatterns?: readonly string[] | null;
};

export type IndexInput = {
  content: PMNode;
  space: SpaceConfig;
};
