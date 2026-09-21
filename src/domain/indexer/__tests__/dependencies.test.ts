import { describe, expect, it } from 'vitest';
import type { PMNode } from '@/domain/doc';
import { indexDocumentVersion } from '..';
import { doc, link, marker, para, row, table, td, text, th } from './fixtures';

const space = { key: 'SJ' };
const index = (content: PMNode) => indexDocumentVersion({ content, space });

const config = (attrs: Record<string, unknown>): PMNode => ({ type: 'propertyConfig', attrs });

/**
 * Invariant P1, named after the example in 01-domain-model.md: "FN-01 references BR-01
 * ⇒ BR-01 is a parent of FN-01". Every engineer gets this backwards once; this test is
 * written before the implementation and is the reason the direction is right.
 */
describe('P1 — FN-01 references BR-01, so BR-01 is a parent of FN-01', () => {
  it('makes the requirement containing the link the child', () => {
    const result = index(
      doc(
        para(marker('BR-01'), text(' The business shall record every access.')),
        para(marker('FN-01'), text(' The system shall log every access, refining '), link('BR-01')),
      ),
    );

    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0]).toMatchObject({
      childKey: 'FN-01',
      targetKey: 'BR-01',
      targetSpaceKey: 'SJ',
    });
  });

  it('records the link as a dependency, not as a citation', () => {
    const result = index(doc(para(marker('FN-01'), text(' refines '), link('BR-01'))));
    expect(result.dependencies.map((dependency) => dependency.targetKey)).toEqual(['BR-01']);
    expect(result.links).toEqual([]);
  });
});

describe('relationship naming (research §4.1)', () => {
  it('horizontal table: the column header of the column holding the link', () => {
    const result = index(
      doc(
        table(
          row(th(para(text('Title'))), th(para(text('Refines'))), th(para(text('Key')))),
          row(td(para(text('Log every access'))), td(para(link('BR-01'))), td(para(marker('FN-01')))),
        ),
      ),
    );

    expect(result.dependencies).toEqual([
      expect.objectContaining({ childKey: 'FN-01', relationship: 'Refines', targetKey: 'BR-01' }),
    ]);
  });

  it('vertical table: the row header of the row holding the link', () => {
    const result = index(
      doc(
        table(
          row(th(para(text('Title'))), td(para(text('Log every access')))),
          row(th(para(text('Verifies'))), td(para(link('BR-01')))),
          row(th(para(text('Key'))), td(para(marker('FN-01')))),
        ),
      ),
    );

    expect(result.dependencies).toEqual([
      expect.objectContaining({ childKey: 'FN-01', relationship: 'Verifies', targetKey: 'BR-01' }),
    ]);
  });

  it('paragraph: the relationship is the literal Dependency', () => {
    const result = index(doc(para(marker('FN-01'), text(' refines '), link('BR-01'))));
    expect(result.dependencies[0]!.relationship).toBe('Dependency');
  });

  it('propertyConfig.relationship overrides the header text', () => {
    const result = index(
      doc(
        table(
          row(
            th(para(text('Title'))),
            th(config({ relationship: 'satisfies' }), para(text('Upstream'))),
            th(para(text('Key'))),
          ),
          row(td(para(text('Log every access'))), td(para(link('BR-01'))), td(para(marker('FN-01')))),
        ),
      ),
    );

    expect(result.dependencies[0]!.relationship).toBe('satisfies');
  });

  it('carries the target space and the baseline pin from the link node', () => {
    const result = index(
      doc(para(marker('FN-01'), text(' refines '), link('BR-01', { spaceKey: 'OTHER', baselineNumber: 3 }))),
    );

    expect(result.dependencies[0]).toMatchObject({
      targetSpaceKey: 'OTHER',
      targetKey: 'BR-01',
      targetBaselineNumber: 3,
    });
  });
});

describe('what is not a dependency', () => {
  it('a link outside every requirement scope stays a citation', () => {
    const result = index(
      doc(para(marker('FN-01'), text(' A requirement.')), para(text('See also '), link('BR-01'))),
    );

    expect(result.dependencies).toEqual([]);
    expect(result.links.map((citation) => citation.targetKey)).toEqual(['BR-01']);
  });

  it('a link in another requirement row belongs to that row, not to its neighbour', () => {
    const result = index(
      doc(
        table(
          row(th(para(text('Title'))), th(para(text('Refines'))), th(para(text('Key')))),
          row(td(para(text('First'))), td(para(link('BR-01'))), td(para(marker('FN-01')))),
          row(td(para(text('Second'))), td(para(link('BR-02'))), td(para(marker('FN-02')))),
        ),
      ),
    );

    expect(result.dependencies).toEqual([
      expect.objectContaining({ childKey: 'FN-01', targetKey: 'BR-01' }),
      expect.objectContaining({ childKey: 'FN-02', targetKey: 'BR-02' }),
    ]);
  });

  it('RD-029: a marker demoted by rule S1 stays a citation and never becomes a dependency', () => {
    const result = index(doc(para(marker('FN-01'), text(' and '), marker('FN-02'))));

    expect(result.dependencies).toEqual([]);
    expect(result.links.map((citation) => citation.targetKey)).toEqual(['FN-02']);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('DUPLICATE_MARKER_IN_SCOPE');
  });
});

describe('RD-029 — a link column is a relationship column, not a property', () => {
  it('a cell holding only links produces no inline property', () => {
    const result = index(
      doc(
        table(
          row(th(para(text('Title'))), th(para(text('Refines'))), th(para(text('Key')))),
          row(td(para(text('Log every access'))), td(para(link('BR-01'))), td(para(marker('FN-01')))),
        ),
      ),
    );

    expect(result.properties.map((property) => property.name)).not.toContain('Refines');
    expect(result.dependencies).toHaveLength(1);
  });

  it('a cell mixing text and links produces both', () => {
    const result = index(
      doc(
        table(
          row(th(para(text('Title'))), th(para(text('Notes'))), th(para(text('Key')))),
          row(
            td(para(text('Log every access'))),
            td(para(text('Derived from '), link('BR-01'))),
            td(para(marker('FN-01'))),
          ),
        ),
      ),
    );

    expect(result.properties.map((property) => [property.name, property.value])).toEqual([
      ['Notes', 'Derived from BR-01'],
    ]);
    expect(result.dependencies).toHaveLength(1);
  });

  it('several links in one cell are several dependencies with the same relationship', () => {
    const result = index(
      doc(
        table(
          row(th(para(text('Title'))), th(para(text('Refines'))), th(para(text('Key')))),
          row(
            td(para(text('Log every access'))),
            td(para(link('BR-01'), text(' '), link('BR-02'))),
            td(para(marker('FN-01'))),
          ),
        ),
      ),
    );

    expect(result.dependencies.map((dependency) => dependency.targetKey)).toEqual(['BR-01', 'BR-02']);
    expect(new Set(result.dependencies.map((dependency) => dependency.relationship))).toEqual(new Set(['Refines']));
  });
});

describe('determinism holds with dependencies (contract I1)', () => {
  it('is byte-identical across runs', () => {
    const content = doc(
      table(
        row(th(para(text('Title'))), th(para(text('Refines'))), th(para(text('Key')))),
        row(td(para(text('First'))), td(para(link('BR-01'))), td(para(marker('FN-01')))),
      ),
    );
    expect(JSON.stringify(index(content))).toEqual(JSON.stringify(index(content)));
  });
});
