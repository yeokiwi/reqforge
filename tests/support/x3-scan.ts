/**
 * The rule-X3 scanner, kept separate from the test so a deliberately bad fixture can
 * prove it bites. spec: 07-permissions-and-limits.md rule X3 — "There is no code path
 * that reads requirements without it. This is tested by a test that greps for direct
 * table access outside the repository."
 *
 * Inside the repository layer every function that reads requirement or document content
 * must either apply the visibility predicate or say, in an `X3-exempt:` comment, why it is
 * a system read (an indexer, a uniqueness check, a job that writes rather than shows).
 */

/** A Prisma read of a table that holds requirement or document content. */
const CONTENT_READ =
  /\b(?:prisma|tx)\.(?:requirement|document|documentVersion|documentLink|dependency|property|indexDiagnostic|requirementHistory|unresolvedDependency|requirementValidation|baselineDanglingDependency)\.(?:findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|count|groupBy|aggregate)\b/;

/** Raw SQL that reads those tables. */
const RAW_READ = /\b(?:FROM|JOIN)\s+"(?:Requirement|Document|DocumentVersion|RequirementHistory)"/;

/** Evidence that the function applies rule X3. */
const APPLIES_X3 =
  /\b(?:requirementVisibility|documentVisibility|documentEditability|documentGatePredicate|visibleRequirementIdsFor|visibleDocumentIds|isDocumentVisible|isDocumentEditable|visibilityPredicate)\b|\bvisibility\s*[:,)]/;

const EXEMPT = /X3-exempt:\s*\S/;

export type Offender = { file: string; fn: string };

/** Splits a source file into its top-level functions, each with the comment above it. */
export function functionsOf(text: string): Array<{ name: string; body: string }> {
  const starts = [
    ...text.matchAll(/^(?:\/\*\*(?:(?!\*\/)[\s\S])*\*\/\n)?(?:export )?(?:async )?function (\w+)/gm),
  ];
  return starts.map((match, index) => ({
    name: match[1]!,
    body: text.slice(match.index, starts[index + 1]?.index ?? text.length),
  }));
}

export function x3Offenders(files: ReadonlyArray<{ path: string; text: string }>): Offender[] {
  const offenders: Offender[] = [];
  for (const file of files) {
    for (const fn of functionsOf(file.text)) {
      const reads = CONTENT_READ.test(fn.body) || RAW_READ.test(fn.body);
      if (!reads) continue;
      if (APPLIES_X3.test(fn.body) || EXEMPT.test(fn.body)) continue;
      offenders.push({ file: file.path, fn: fn.name });
    }
  }
  return offenders;
}
