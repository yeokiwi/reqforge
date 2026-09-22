import { describe, expect, it } from 'vitest';
import { baselineReportDocument, baselineReportTitle } from '../report';

/** spec: 05-baselines-and-diff.md §2; RD-045 */

describe('the baseline report document', () => {
  const input = { number: 3, name: 'Release 1.3c' };

  it('is titled for the baseline it reports on', () => {
    expect(baselineReportTitle(input)).toBe('Baseline 3 — Release 1.3c');
  });

  it('is a document with a heading and a live report over the baseline', () => {
    const document = baselineReportDocument(input);
    expect(document.type).toBe('doc');
    expect(document.content?.map((node) => node.type)).toEqual(['heading', 'paragraph', 'report', 'paragraph']);

    const report = document.content?.find((node) => node.type === 'report');
    expect(report?.attrs).toMatchObject({ query: 'baseline = 3', countOnly: false });
  });

  it('names the baseline in the query, so the document says what it reports on', () => {
    // `$currentBaseline` is what a matrix embedded here later resolves through (RD-031);
    // the report itself is explicit, so the document reads correctly as plain text.
    const report = baselineReportDocument({ number: 12, name: 'x' }).content?.find(
      (node) => node.type === 'report',
    );
    expect(report?.attrs?.query).toBe('baseline = 12');
  });

  it('gives the report a stable id, which is what resolution keys off (RD-035)', () => {
    const report = baselineReportDocument(input).content?.find((node) => node.type === 'report');
    expect(report?.attrs?.id).toBe('baseline-3');
  });
});
