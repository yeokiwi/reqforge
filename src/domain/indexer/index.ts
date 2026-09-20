import { attr, numericAttr, renderHtml, walk, type PMNode } from '@/domain/doc';
import { matchesAnyPattern, parsePattern, matchesPattern } from '@/domain/keys/pattern';
import { checkKey } from '@/domain/keys/validate';
import { normaliseSearchText, normaliseSearchValue } from './normalise';
import { extractProperties } from './properties';
import { findNodes, resolveScope, type Marker, type Scope } from './scope';
import type {
  Diagnostic,
  IndexInput,
  IndexResult,
  IndexedProperty,
  IndexedRequirement,
  SpaceTypeConfig,
} from './types';

export * from './types';
export * from './normalise';
export * from './properties';
export { findNodes, resolveScope } from './scope';
export type { Marker, Scope } from './scope';

const MARKER_TYPES = new Set(['requirement']);
const LINK_TYPES = new Set(['requirementLink']);

/**
 * Document JSON + space configuration → requirement records. **Pure**: no database access.
 * spec: 03-authoring-and-indexing.md §3
 *
 * Contract I1 (determinism): the output depends only on the input, is built in document
 * order, and contains no generated ids or timestamps.
 * Contract I4 (synchronous excerpts, RD-005): title, bodyHtml and bodySearch are produced
 * here, never deferred to a later page view.
 */
export function indexDocumentVersion(input: IndexInput): IndexResult {
  const diagnostics: Diagnostic[] = [];
  const requirements: IndexedRequirement[] = [];
  const properties: IndexedProperty[] = [];

  const types = input.space.types ?? [];
  const configuredPatterns = types.map((type) => type.keyPattern);
  const lockingIsOn = types.some((type) => type.locked);

  const markers = findNodes(input.content, MARKER_TYPES);
  const scopeOwner = new Map<string, string>(); // scope id -> key that claimed it
  const definedKeys = new Map<string, Marker>(); // upperKey -> defining marker
  /** Markers demoted to links: rule S1 (second marker in a scope) or S2 (repeat key). */
  const demoted: Marker[] = [];

  for (const marker of markers) {
    const rawKey = attr(marker.node, 'key') ?? '';
    const checked = checkKey(rawKey);

    if (!checked.ok) {
      diagnostics.push({
        code: 'KEY_INVALID',
        severity: 'error',
        message: checked.message,
        path: marker.path,
        key: rawKey,
      });
      continue;
    }

    if (lockingIsOn && !matchesAnyPattern(configuredPatterns, checked.key)) {
      // spec 03 §4.3 — the row is still indexed; the diagnostic is what the editor shows.
      diagnostics.push({
        code: 'KEY_NOT_ALLOWED',
        severity: 'error',
        message: `${checked.key} matches none of this space's key patterns (${configuredPatterns.join(', ')}).`,
        path: marker.path,
        key: checked.key,
      });
    }

    const scope = resolveScope(marker);

    // Rule S1 — one requirement per scope; a second marker is indexed as a link instead.
    const owner = scopeOwner.get(scope.id);
    if (owner !== undefined) {
      diagnostics.push({
        code: 'DUPLICATE_MARKER_IN_SCOPE',
        severity: 'error',
        message: `This scope already defines ${owner}. ${checked.key} is indexed as a link to it instead.`,
        path: marker.path,
        key: checked.key,
      });
      demoted.push(marker);
      continue;
    }

    // Rule S2 — within a document the first occurrence of a key is the definition;
    // later occurrences become links to it.
    const existing = definedKeys.get(checked.upperKey);
    if (existing) {
      demoted.push(marker);
      continue;
    }

    scopeOwner.set(scope.id, checked.key);
    definedKeys.set(checked.upperKey, marker);

    if (scope.headerless) {
      // Rule S4 — a table with neither a header row nor a header column.
      diagnostics.push({
        code: 'TABLE_HAS_NO_HEADER',
        severity: 'warning',
        message:
          'This table has neither a header row nor a header column, so its columns cannot name properties.',
        path: marker.path,
        key: checked.key,
      });
    }

    if (containsImage(scope.body)) {
      // spec 03 §7 / research §5.3 leak 2 — images do not baseline well. RD-012 fixes the
      // freeze side; the warning stays because an image still cannot be diffed.
      diagnostics.push({
        code: 'IMAGE_IN_REQUIREMENT',
        severity: 'warning',
        message: 'This requirement contains an image. Images are materialised on freeze but never diffed.',
        path: marker.path,
        key: checked.key,
      });
    }

    const extracted = extractProperties(scope, checked.key, marker.path);
    properties.push(...extracted.properties);
    diagnostics.push(...extracted.diagnostics);

    requirements.push(buildRequirement(marker, scope, checked.key, checked.upperKey, types, extracted));
  }

  // Citations: `requirementLink` nodes, plus markers demoted by rules S1 and S2.
  const links = [
    ...findNodes(input.content, LINK_TYPES).map((link) => ({
      targetSpaceKey: attr(link.node, 'spaceKey') ?? input.space.key,
      targetKey: attr(link.node, 'key') ?? '',
      path: link.path,
    })),
    ...demoted.map((marker) => ({
      targetSpaceKey: input.space.key,
      targetKey: attr(marker.node, 'key') ?? '',
      path: marker.path,
    })),
  ]
    .filter((link) => link.targetKey.length > 0)
    .sort(byPath);

  return {
    requirements,
    properties,
    // Dependencies arrive in slice 7; the array is part of the contract from the start so
    // consumers do not have to change shape later.
    dependencies: [],
    links,
    diagnostics,
  };
}

function buildRequirement(
  marker: Marker,
  scope: Scope,
  key: string,
  upper: string,
  types: readonly SpaceTypeConfig[],
  extracted: { title: string | null; contentText: string | null },
): IndexedRequirement {
  const configured = extracted.title !== null && extracted.title.length > 0 ? extracted.title : null;
  const title = configured ?? (scope.title.length > 0 ? scope.title : key);
  return {
    key,
    upperKey: upper,
    // A stable uid survives renames (spec 03 §1.1). The fallback is derived from the key
    // rather than generated, so contract I1 (determinism) holds for older documents.
    uid: attr(marker.node, 'uid') ?? `auto-${upper}`,
    typeId: attr(marker.node, 'typeId') ?? typeByPattern(types, key),
    title,
    bodyHtml: renderHtml(scope.body),
    // RY's `text` field is "contents; excludes properties" (research §3.2), so in a table
    // layout `bodySearch` carries the title field's text, not the property cells. A
    // paragraph or a headerless table has no properties, so the whole scope is the text.
    bodySearch:
      extracted.contentText === null
        ? normaliseSearchText(scope.body)
        : normaliseSearchValue(extracted.contentText),
    anchorPath: marker.path,
    layout: scope.layout,
  };
}

/**
 * A marker without an explicit type takes the type whose pattern its key matches.
 * spec: 06-requirement-types.md §1 — a type *is* its key pattern; research §2.3.
 */
function typeByPattern(types: readonly SpaceTypeConfig[], key: string): string | null {
  for (const type of types) {
    const parsed = parsePattern(type.keyPattern);
    if (parsed.ok && matchesPattern(parsed.pattern, key)) return type.id;
  }
  return null;
}

function containsImage(node: PMNode): boolean {
  for (const entry of walk(node)) {
    if (entry.node.type === 'image') return true;
  }
  return false;
}

function byPath(a: { path: string }, b: { path: string }): number {
  const left = a.path.split('.').map(Number);
  const right = b.path.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? -1) - (right[index] ?? -1);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Baseline pin on a link node, e.g. `SJ/FN-001@3` (research §4.1). Used from slice 7. */
export function linkBaselineNumber(node: PMNode): number | null {
  return numericAttr(node, 'baselineNumber') ?? null;
}
