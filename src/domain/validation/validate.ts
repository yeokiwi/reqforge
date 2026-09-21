import type { Diagnostic } from '@/domain/indexer/types';
import {
  addColumnFix,
  addDependencyFix,
  promoteHeaderFix,
  setCellValueFix,
  type DiagnosticFix,
  type Placement,
} from './fixes';
import { compilePattern, lookupName, type Rule } from './rules';

/** spec: 06-requirement-types.md §2.1 */
export type ValidationStatus = 'TRUE' | 'FALSE' | 'WARNING';

export type SubjectProperty = { name: string; searchName: string; value: string };

/**
 * Everything validating one requirement needs, and nothing more.
 * spec: 06-requirement-types.md §2.3 — "Validation of one requirement must issue zero
 * additional queries": the subject is assembled by the caller, in batch, and the
 * validator never reaches for anything else.
 */
export type Subject = {
  key: string;
  anchorPath: string;
  properties: readonly SubjectProperty[];
  /** Relationship names on edges this requirement declares (`to`, child → parent). */
  outbound: readonly string[];
  /** Relationship names on edges declared *at* this requirement (`from`, parent → child). */
  inbound: readonly string[];
  /** Rule S4 — a table with neither a header row nor a header column. */
  headerlessTable?: boolean;
  /** Absent when there is no document in hand, e.g. the revalidation job. */
  placement?: Placement | null;
};

export type ValidationOutcome = { status: ValidationStatus; diagnostics: Diagnostic[] };

/**
 * The whole of spec `06` §2.1's table, as one pure function.
 *
 * | all rules pass                                              | TRUE    |
 * | a required property or dependency missing, or a value rule fails | FALSE |
 * | an optional property missing, or the table has no real header    | WARNING |
 *
 * `FALSE` beats `WARNING`: a requirement with a missing required column and a missing
 * optional one is red, not yellow.
 */
export function validateRequirement(subject: Subject, rules: readonly Rule[]): ValidationOutcome {
  const diagnostics: Diagnostic[] = [];
  const placement = subject.placement ?? null;
  const byName = new Map(subject.properties.map((property) => [property.searchName, property]));

  const push = (
    code: Diagnostic['code'],
    severity: Diagnostic['severity'],
    message: string,
    fix: DiagnosticFix | null,
  ) => {
    diagnostics.push({
      code,
      severity,
      message,
      path: subject.anchorPath,
      key: subject.key,
      ...(fix ? { fix } : {}),
    });
  };

  // Rule S4's warning is a validation outcome as well as an indexing one: a headerless
  // table cannot name properties, so every rule about one is unanswerable.
  if (subject.headerlessTable) {
    push(
      'TABLE_HAS_NO_HEADER',
      'warning',
      'This table has neither a header row nor a header column, so its columns cannot name properties.',
      promoteHeaderFix(placement),
    );
  }

  for (const rule of rules) {
    switch (rule.kind) {
      case 'REQUIRED_PROPERTY': {
        if (!hasValue(byName, rule.name)) {
          push(
            'MISSING_REQUIRED_PROPERTY',
            'error',
            `${subject.key} needs a ${rule.name}.`,
            addColumnFix(placement, rule.name),
          );
        }
        break;
      }

      case 'OPTIONAL_PROPERTY': {
        if (!hasValue(byName, rule.name)) {
          push(
            'MISSING_OPTIONAL_PROPERTY',
            'warning',
            `${subject.key} has no ${rule.name}.`,
            addColumnFix(placement, rule.name),
          );
        }
        break;
      }

      case 'REQUIRED_DEPENDENCY': {
        const edges = rule.direction === 'to' ? subject.outbound : subject.inbound;
        if (!edges.some((relationship) => relationship === rule.relationship)) {
          const phrasing =
            rule.direction === 'to'
              ? `${subject.key} must depend on something with the relationship "${rule.relationship}".`
              : `Something must depend on ${subject.key} with the relationship "${rule.relationship}".`;
          push(
            'MISSING_REQUIRED_DEPENDENCY',
            'error',
            phrasing,
            addDependencyFix(placement, rule.relationship, rule.direction),
          );
        }
        break;
      }

      case 'PROPERTY_MATCHES': {
        const property = byName.get(lookupName(rule.name));
        // A rule about a property that is not there is reported by the REQUIRED_PROPERTY
        // rule, if the type has one. A value rule alone does not make a property required.
        if (!property || property.value.trim().length === 0) break;

        const expression = compilePattern(rule.pattern);
        // An uncompilable pattern is the type author's mistake, not this requirement's.
        if (!expression) break;
        if (!expression.test(property.value)) {
          push(
            'PROPERTY_DOES_NOT_MATCH',
            'error',
            `${rule.name} is "${property.value}", which does not match ${rule.pattern}.`,
            null,
          );
        }
        break;
      }

      case 'PROPERTY_IN': {
        const property = byName.get(lookupName(rule.name));
        if (!property || property.value.trim().length === 0) break;

        // Property values are case-sensitive (spec 02 §2.1), so membership is exact.
        if (!rule.values.includes(property.value)) {
          push(
            'PROPERTY_NOT_IN_VALUES',
            'error',
            `${rule.name} is "${property.value}", which is not one of: ${rule.values.join(', ')}.`,
            setCellValueFix(placement, rule.name, lookupName(rule.name), rule.values),
          );
        }
        break;
      }
    }
  }

  return { status: statusOf(diagnostics), diagnostics };
}

function hasValue(byName: Map<string, SubjectProperty>, name: string): boolean {
  const property = byName.get(lookupName(name));
  return property !== undefined && property.value.trim().length > 0;
}

/** spec 06 §2.1 — an error makes it FALSE, a warning alone makes it WARNING. */
export function statusOf(diagnostics: readonly Diagnostic[]): ValidationStatus {
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return 'FALSE';
  if (diagnostics.length > 0) return 'WARNING';
  return 'TRUE';
}

/** The stored `messages` of a `RequirementValidation` row, for the screens and the pills. */
export function messagesOf(diagnostics: readonly Diagnostic[]): Array<{ code: string; severity: string; message: string }> {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
  }));
}
