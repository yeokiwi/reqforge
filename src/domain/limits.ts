/**
 * The limits of spec 07 §4, in one place. Pure.
 * spec: 07-permissions-and-limits.md §4 — "Configured per installation with per-space
 * overrides. Defaults are RY's documented numbers where they exist." RD-071.
 *
 * Every hard limit is enforced with `LimitExceededError`, whose message names the limit by
 * the label below; a warning threshold is a diagnostic, never a block.
 */
import { LimitExceededError, ValidationError } from './errors';
import type { Diagnostic, IndexResult } from './indexer/types';
import { MAX_TRAVERSAL_DEPTH } from './ryql/fields';

/**
 * How far an installation or a space may move a limit (RD-071):
 * - `any` — up or down;
 * - `lower-only` — the code path is sized for the default (the compiler caps a page at 600,
 *   the grid renders at most 200 × 200), so it may be tightened but never raised;
 * - `fixed` — part of a contract that needs a decision-log entry to change.
 */
export type OverrideClass = 'any' | 'lower-only' | 'fixed';

export type LimitDefinition = {
  label: string;
  default: number;
  kind: 'hard' | 'warning';
  override: OverrideClass;
  /** Where the default comes from: research §6.7 (RY) or our own decision. */
  source: string;
};

export const LIMITS = {
  requirementsPerSpace: { label: 'Requirements per space', default: 12_000, kind: 'hard', override: 'any', source: 'RY global limit (research §6.7)' },
  requirementsPerBaseline: { label: 'Requirements per baseline', default: 12_000, kind: 'hard', override: 'any', source: 'RY (research §6.7)' },
  requirementsPerDocument: { label: 'Requirements per document', default: 400, kind: 'hard', override: 'any', source: 'RY (research §6.7)' },
  requirementsPerDocumentWarning: { label: 'Requirements per document (warning)', default: 150, kind: 'warning', override: 'any', source: 'RY (research §6.7)' },
  diffRows: { label: 'Diff rows (interactive)', default: 600, kind: 'hard', override: 'lower-only', source: 'RY (research §6.7)' },
  diffInteractiveMax: { label: 'Requirements compared interactively', default: 2_000, kind: 'hard', override: 'lower-only', source: 'ours (05 §5.4)' },
  matrixPageSizeMax: { label: 'Matrix page size', default: 600, kind: 'hard', override: 'lower-only', source: 'RY (research §6.7)' },
  dependencyMatrixCells: { label: 'Dependency matrix web cells', default: 40_000, kind: 'hard', override: 'lower-only', source: 'RY (research §6.7)' },
  dependencyExportAxis: { label: 'Dependency matrix export axis', default: 5_000, kind: 'hard', override: 'lower-only', source: "RY's tested size (research §4.3)" },
  traversalDepth: { label: 'Traversal depth (->)', default: MAX_TRAVERSAL_DEPTH, kind: 'hard', override: 'fixed', source: 'ours (02 §5.1, RD-021)' },
  renameRequirements: { label: 'Requirements per rename', default: 2_000, kind: 'hard', override: 'any', source: 'ours (RD-054)' },
  renameDocuments: { label: 'Documents rewritten per rename', default: 1_000, kind: 'hard', override: 'any', source: 'ours (RD-054)' },
  rulesPerType: { label: 'Rules per requirement type', default: 40, kind: 'hard', override: 'any', source: 'ours' },
  typesPerDocument: { label: 'Types applying to one document', default: 20, kind: 'hard', override: 'any', source: 'RY' },
  importRows: { label: 'Import rows per file', default: 5_000, kind: 'hard', override: 'fixed', source: "ours — RY's docs conflict" },
} as const satisfies Record<string, LimitDefinition>;

export type LimitId = keyof typeof LIMITS;
export type Limits = Readonly<Record<LimitId, number>>;
export type LimitOverrides = Partial<Record<LimitId, number>>;

export const LIMIT_IDS = Object.keys(LIMITS) as LimitId[];

/** Warning thresholds and the hard limit each must stay below. */
const WARNING_OF: Partial<Record<LimitId, LimitId>> = {
  requirementsPerDocumentWarning: 'requirementsPerDocument',
};

export function isLimitId(value: string): value is LimitId {
  return Object.hasOwn(LIMITS, value);
}

/**
 * Parses an override object from anywhere it can come from — `REQFORGE_LIMITS`, the admin
 * form, a stored `Space.limits` — and refuses anything it does not understand rather than
 * ignoring it: a mistyped limit name silently doing nothing is how a limit gets lost.
 */
export function parseLimitOverrides(raw: unknown, source: string): LimitOverrides {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError(`${source} must be an object of limit names to numbers.`);
  }
  const out: LimitOverrides = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isLimitId(name)) throw new ValidationError(`${source}: "${name}" is not a limit. Known limits: ${LIMIT_IDS.join(', ')}.`);
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      throw new ValidationError(`${source}: "${LIMITS[name].label}" must be a whole number of at least 1.`);
    }
    out[name] = value;
  }
  return out;
}

/**
 * The effective limits: spec defaults, then the installation's values, then the space's.
 * Each layer is checked against the override class, so a space can never raise what the
 * code cannot carry. spec 07 §4; RD-071.
 */
export function resolveLimits(installation: LimitOverrides = {}, space: LimitOverrides = {}): Limits {
  const resolved = Object.fromEntries(LIMIT_IDS.map((id) => [id, LIMITS[id].default])) as Record<LimitId, number>;
  for (const [layer, overrides] of [
    ['REQFORGE_LIMITS', installation],
    ['The space override', space],
  ] as const) {
    for (const id of LIMIT_IDS) {
      const value = overrides[id];
      if (value === undefined) continue;
      const definition = LIMITS[id];
      if (definition.override === 'fixed' && value !== definition.default) {
        throw new ValidationError(`${layer}: "${definition.label}" is fixed at ${definition.default} and cannot be overridden.`);
      }
      if (definition.override === 'lower-only' && value > definition.default) {
        throw new ValidationError(`${layer}: "${definition.label}" may be lowered but not raised above ${definition.default}.`);
      }
      resolved[id] = value;
    }
  }
  for (const [warning, hard] of Object.entries(WARNING_OF) as Array<[LimitId, LimitId]>) {
    if (resolved[warning] >= resolved[hard]) {
      throw new ValidationError(
        `"${LIMITS[warning].label}" (${resolved[warning]}) must be below "${LIMITS[hard].label}" (${resolved[hard]}).`,
      );
    }
  }
  return resolved;
}

export const DEFAULT_LIMITS: Limits = resolveLimits();

/** The named error, with the limit's label. spec 07 §4 — "the limit named in the message". */
export function limitExceeded(id: LimitId, limit: number, actual: number, what: string): LimitExceededError {
  return new LimitExceededError(id, LIMITS[id].label, limit, actual, what);
}

/**
 * The per-document limits, over an index result (spec 07 §4). Pure, and applied by the
 * save use case before anything is written, so the indexer's own output is unchanged
 * (RD-072).
 */
export function checkDocumentLimits(
  result: Pick<IndexResult, 'requirements'>,
  limits: Pick<Limits, 'requirementsPerDocument' | 'requirementsPerDocumentWarning' | 'typesPerDocument'>,
): { violation: LimitExceededError | null; warnings: Diagnostic[] } {
  const count = result.requirements.length;
  if (count > limits.requirementsPerDocument) {
    return {
      violation: limitExceeded('requirementsPerDocument', limits.requirementsPerDocument, count, `this document has ${count} requirements`),
      warnings: [],
    };
  }
  const types = new Set(result.requirements.map((requirement) => requirement.typeId).filter((id): id is string => id !== null));
  if (types.size > limits.typesPerDocument) {
    return {
      violation: limitExceeded('typesPerDocument', limits.typesPerDocument, types.size, `this document's requirements belong to ${types.size} types`),
      warnings: [],
    };
  }
  const warnings: Diagnostic[] =
    count > limits.requirementsPerDocumentWarning
      ? [
          {
            code: 'DOCUMENT_LARGE',
            severity: 'warning',
            message: `This document has ${count} requirements. Above ${limits.requirementsPerDocumentWarning} a document is slow to save and to open; at ${limits.requirementsPerDocument} saving is refused. Consider splitting it.`,
            path: '',
          },
        ]
      : [];
  return { violation: null, warnings };
}
