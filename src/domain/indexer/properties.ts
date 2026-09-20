import { booleanAttr, childrenOf, plainText, walk, WITHOUT_MARKERS, type PMNode } from '@/domain/doc';
import { attr } from '@/domain/doc';
import { nameIsSearchableUnquoted, searchNameOf } from './normalise';
import type { ScopeField, Scope } from './scope';
import type { Diagnostic, IndexedProperty } from './types';

/**
 * A column's (or row's) configuration.
 * spec: 03-authoring-and-indexing.md §1.3 — `propertyConfig` overrides; without it the
 * header's plain text is the property name and the first non-ignored column is the title.
 */
export type FieldConfig = {
  name: string;
  isTitle: boolean;
  ignored: boolean;
  relationship: string | null;
};

/** Finds a `propertyConfig` node anywhere inside a header cell. */
function configNode(cell: PMNode | undefined): PMNode | undefined {
  if (!cell) return undefined;
  for (const entry of walk(cell)) {
    if (entry.node.type === 'propertyConfig') return entry.node;
  }
  return undefined;
}

export function readFieldConfig(header: PMNode | undefined): FieldConfig {
  const headerText = header ? plainText(header, WITHOUT_MARKERS) : '';
  const config = configNode(header);
  if (!config) {
    return { name: headerText, isTitle: false, ignored: false, relationship: null };
  }

  return {
    name: attr(config, 'name') ?? headerText,
    isTitle: booleanAttr(config, 'isTitle'),
    ignored: booleanAttr(config, 'ignored'),
    relationship: attr(config, 'relationship') ?? null,
  };
}

const LIST_TYPES = new Set(['bulletList', 'orderedList']);

/**
 * A cell is list-valued when its content is a bullet or ordered list; each item is one
 * member. `=` then behaves as set membership (invariant R3, RD-027).
 */
export function cellValues(cell: PMNode | undefined): string[] {
  if (!cell) return [];

  const list = childrenOf(cell).find((child) => LIST_TYPES.has(child.type));
  if (list) {
    return childrenOf(list)
      .map((item) => plainText(item, WITHOUT_MARKERS))
      .filter((value) => value.length > 0);
  }

  const single = plainText(cell, WITHOUT_MARKERS);
  return single.length > 0 ? [single] : [];
}

export type ExtractedProperties = {
  properties: IndexedProperty[];
  diagnostics: Diagnostic[];
  /** The title from the `isTitle` column, when one is configured. */
  title: string | null;
  /**
   * The requirement's own text — the title field's value in a table layout. RY's `text`
   * field "excludes properties" (research §3.2), so this is what `bodySearch` gets.
   */
  contentText: string | null;
};

/**
 * Inline properties of one requirement.
 * spec: 03-authoring-and-indexing.md §1.3, §3.1 — column-header names, title column,
 * ignored columns, list-valued cells, and the `PROPERTY_NAME_NOT_SEARCHABLE` warning.
 */
export function extractProperties(scope: Scope, key: string, markerPath: string): ExtractedProperties {
  const properties: IndexedProperty[] = [];
  const diagnostics: Diagnostic[] = [];
  let ordinal = 0;

  // A headerless table names nothing, so it has no properties at all (rule S4), and a
  // paragraph has none either (spec 03 §2).
  const fields = scope.headerless
    ? []
    : scope.fields.map((field) => ({ field, config: readFieldConfig(field.header?.node) }));

  // spec 03 §1.3 — an `isTitle` column wins; otherwise the first non-ignored column is the
  // title (research §2.5). Either way the title column is not also a property.
  const titleEntry =
    fields.find((entry) => entry.config.isTitle) ??
    fields.find(
      (entry) =>
        !entry.config.ignored &&
        entry.config.name.length > 0 &&
        !isMarkerOnlyField(scope, entry.field),
    );

  for (const entry of fields) {
    if (entry === titleEntry) continue;
    if (entry.config.ignored || entry.config.name.length === 0) continue;
    if (isMarkerOnlyField(scope, entry.field)) continue;

    const values = cellValues(entry.field.value?.node);
    if (values.length === 0) continue;

    if (!nameIsSearchableUnquoted(entry.config.name)) {
      // RD-011: the name is kept verbatim and stays queryable in the quoted form.
      diagnostics.push({
        code: 'PROPERTY_NAME_NOT_SEARCHABLE',
        severity: 'warning',
        message: `Property name "${entry.config.name}" contains a space. Query it as @'${entry.config.name}' or @${entry.config.name.replace(/ /g, '\\ ')}.`,
        path: markerPath,
        key,
      });
    }

    const searchName = searchNameOf(entry.config.name);
    // One row per member: that is how `=` becomes set membership for a list-valued cell
    // (research §3.7, invariant R3, RD-027).
    values.forEach((value, valueIndex) => {
      properties.push({ key, name: entry.config.name, searchName, value, valueOrdinal: ordinal, valueIndex });
    });
    ordinal += 1;
  }

  const titleValues = titleEntry ? cellValues(titleEntry.field.value?.node) : [];
  const title = titleValues.length > 0 ? titleValues.join(' ') : null;

  return { properties, diagnostics, title, contentText: titleEntry ? (title ?? '') : null };
}

function isMarkerOnlyField(scope: Scope, field: ScopeField): boolean {
  if (field.index !== scope.markerField) return false;
  const cell = field.value?.node;
  if (!cell) return true;
  return plainText(cell, WITHOUT_MARKERS).length === 0;
}
