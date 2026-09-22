import type { PMNode } from '@/domain/doc';

/**
 * The baseline report document.
 * spec: 05-baselines-and-diff.md §2 — a DRAFT baseline has "a number, a name, a source
 * query and optionally a report document". `RD-045`: it is created with a live report in
 * it, which is also the path that exercises `RD-031`'s `$currentBaseline` resolution —
 * one saved matrix or report works inside every baseline report document because the
 * baseline it reports on is resolved from the document it sits in.
 */

export function baselineReportTitle(input: { number: number; name: string }): string {
  return `Baseline ${input.number} — ${input.name}`;
}

/**
 * A heading, a line of prose, and a `report` node over this baseline's members. The query
 * names the baseline explicitly rather than using `$currentBaseline`, so the document
 * still says what it reports on when read as plain text; `$currentBaseline` is what any
 * matrix the author embeds later will resolve through.
 */
export function baselineReportDocument(input: { number: number; name: string }): PMNode {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: baselineReportTitle(input) }],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text:
              'The requirements this baseline holds, as they were when it was frozen. ' +
              'Editing the live requirements does not change them.',
          },
        ],
      },
      {
        type: 'report',
        attrs: {
          id: `baseline-${input.number}`,
          query: `baseline = ${input.number}`,
          columns: 'key, description+properties',
          countOnly: false,
          useLastRequirement: false,
          useLastRequirementDefinition: false,
        },
      },
      { type: 'paragraph' },
    ],
  };
}
