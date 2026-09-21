import { attr, numericAttr } from '@/domain/doc';
import { readFieldConfig } from './properties';
import { resolveScope, type Marker, type Scope } from './scope';
import type { IndexedDependency, IndexedLink } from './types';

/**
 * The relationship of a link that sits in no named column or row.
 * research §4.1 — "In paragraphs, the default relationship is `Dependency`."
 */
export const DEFAULT_RELATIONSHIP = 'Dependency';

/**
 * Where a dependency's relationship name comes from.
 * research §4.1 — "in tables, the **column header** of the column holding the link. In
 * paragraphs, the default relationship is `Dependency`."
 *
 * `propertyConfig.relationship` on that header overrides it (spec 03 §1.3).
 */
export function relationshipFor(scope: Scope): string {
  if (scope.layout === 'PARAGRAPH' || scope.headerless) return DEFAULT_RELATIONSHIP;

  const field = scope.fields.find((candidate) => candidate.index === scope.markerField);
  const config = readFieldConfig(field?.header?.node);

  if (config.relationship && config.relationship.length > 0) return config.relationship;
  return config.name.length > 0 ? config.name : DEFAULT_RELATIONSHIP;
}

export type ClassifiedLink =
  | { kind: 'dependency'; dependency: IndexedDependency }
  | { kind: 'citation'; citation: IndexedLink };

/**
 * A `requirementLink` inside a requirement's scope is a **dependency**; anywhere else it
 * is a citation.
 * spec: 03-authoring-and-indexing.md §1.2; invariant P1 — the requirement whose body
 * *contains* the link is the child, and the linked requirement is the parent.
 */
export function classifyLink(link: Marker, ownerByScope: ReadonlyMap<string, string>, spaceKey: string): ClassifiedLink {
  const targetKey = attr(link.node, 'key') ?? '';
  const targetSpaceKey = attr(link.node, 'spaceKey') ?? spaceKey;
  const scope = resolveScope(link);
  const childKey = ownerByScope.get(scope.id);

  if (childKey === undefined) {
    return { kind: 'citation', citation: { targetSpaceKey, targetKey, path: link.path } };
  }

  return {
    kind: 'dependency',
    dependency: {
      childKey,
      relationship: relationshipFor(scope),
      targetSpaceKey,
      targetKey,
      // research §4.1 — a link may be pinned to a baseline of the target.
      targetBaselineNumber: numericAttr(link.node, 'baselineNumber') ?? null,
      path: link.path,
    },
  };
}
