import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { indexDocumentVersion } from '..';
import { doc, horizontalTable, marker, para, paragraphLayout, row, table, td, text, th, verticalTable } from './fixtures';

const space = { key: 'SJ' };
const index = (content: Parameters<typeof indexDocumentVersion>[0]['content']) =>
  indexDocumentVersion({ content, space });

describe('scope layouts (spec 03 §2)', () => {
  it('horizontal table: the scope is the row, the title is the first column', () => {
    const result = index(horizontalTable);
    expect(result.requirements.map((r) => r.key)).toEqual(['FN-001', 'FN-002']);

    const first = result.requirements[0]!;
    expect(first.layout).toBe('HORIZONTAL_TABLE');
    expect(first.title).toBe('The system shall log every access.');
    expect(first.bodySearch).toContain('Security');
    expect(first.bodySearch).toContain('The system shall log every access.');
    // The body excerpt carries the header row so a popup can label the columns.
    expect(first.bodyHtml).toContain('<th><p>Category</p></th>');
    expect(first.anchorPath).toBe('0.1.2.0.0');
  });

  it('vertical table: the scope is the column, the title is the first row', () => {
    const result = index(verticalTable);
    expect(result.requirements.map((r) => r.key)).toEqual(['VR-001', 'VR-002']);

    const first = result.requirements[0]!;
    expect(first.layout).toBe('VERTICAL_TABLE');
    expect(first.title).toBe('Log every access');
    expect(first.bodySearch).toContain('Category');
    expect(first.bodySearch).toContain('Log every access');
    // The other column's values are not part of this requirement.
    expect(first.bodySearch).not.toContain('Rotate keys');
  });

  it('paragraph and list item: the scope is the whole block', () => {
    const result = index(paragraphLayout);
    expect(result.requirements.map((r) => r.key)).toEqual(['PR-001', 'PR-002']);
    expect(result.requirements[0]!.layout).toBe('PARAGRAPH');
    expect(result.requirements[0]!.title).toBe('The system shall expose a health endpoint.');
    expect(result.requirements[1]!.title).toBe('Bullet requirement.');
  });

  it('a title falls back to the key when the scope has no text', () => {
    const result = index(doc(para(marker('FN-009'))));
    expect(result.requirements[0]!.title).toBe('FN-009');
  });
});

describe('rules S1–S4 (spec 03 §2)', () => {
  it('S1: a second marker in the same scope is an error and becomes a link', () => {
    const result = index(
      doc(table(row(th(para(text('Title')))), row(td(para(text('Row'), marker('FN-001'), marker('FN-002')))))),
    );

    expect(result.requirements.map((r) => r.key)).toEqual(['FN-001']);
    const diagnostic = result.diagnostics.find((d) => d.code === 'DUPLICATE_MARKER_IN_SCOPE');
    expect(diagnostic?.severity).toBe('error');
    expect(diagnostic?.key).toBe('FN-002');
    expect(result.links.map((l) => l.targetKey)).toContain('FN-002');
  });

  it('S2: the first occurrence of a key defines it, later ones link to it', () => {
    const result = index(
      doc(para(marker('FN-001'), text(' First definition.')), para(marker('FN-001'), text(' Later mention.'))),
    );

    expect(result.requirements.map((r) => r.key)).toEqual(['FN-001']);
    expect(result.requirements[0]!.title).toBe('First definition.');
    expect(result.links.map((l) => l.targetKey)).toEqual(['FN-001']);
    // S2 is not an error: repeating a key is how you cite it in the same document.
    expect(result.diagnostics).toHaveLength(0);
  });

  it('S4: a table with neither a header row nor a header column warns on every requirement', () => {
    const result = index(
      doc(table(row(td(para(text('Log access'))), td(para(marker('FN-001')))), row(td(para(text('Rotate'))), td(para(marker('FN-002')))))),
    );

    expect(result.requirements).toHaveLength(2);
    const warnings = result.diagnostics.filter((d) => d.code === 'TABLE_HAS_NO_HEADER');
    expect(warnings.map((w) => w.key)).toEqual(['FN-001', 'FN-002']);
    expect(warnings[0]!.severity).toBe('warning');
  });

  it('rejects an invalid key with KEY_INVALID and indexes nothing for it', () => {
    const result = index(doc(para(marker('FN 001'), text(' Bad key.')), para(marker('FN-002'), text(' Good key.'))));

    expect(result.requirements.map((r) => r.key)).toEqual(['FN-002']);
    const diagnostic = result.diagnostics.find((d) => d.code === 'KEY_INVALID');
    expect(diagnostic?.severity).toBe('error');
    expect(diagnostic?.key).toBe('FN 001');
  });

  it('warns about images inside a requirement (research §5.3 leak 2)', () => {
    const result = index(
      doc(para(marker('FN-001'), text(' With a picture '), { type: 'image', attrs: { src: 'https://x/y.png' } })),
    );
    expect(result.diagnostics.map((d) => d.code)).toEqual(['IMAGE_IN_REQUIREMENT']);
  });
});

describe('contract I4 — synchronous excerpts (RD-005)', () => {
  it('produces title, bodyHtml and bodySearch during indexing, not on view', () => {
    for (const requirement of index(horizontalTable).requirements) {
      expect(requirement.title.length).toBeGreaterThan(0);
      expect(requirement.bodyHtml.length).toBeGreaterThan(0);
      expect(requirement.bodySearch.length).toBeGreaterThan(0);
    }
  });
});

describe('contract I1 — determinism', () => {
  it('is byte-identical across runs for the fixtures', () => {
    for (const fixture of [horizontalTable, verticalTable, paragraphLayout]) {
      expect(JSON.stringify(index(fixture))).toEqual(JSON.stringify(index(fixture)));
    }
  });

  it('is byte-identical across runs for generated documents', () => {
    const inline = fc.oneof(
      fc.string({ minLength: 1, maxLength: 12 }).map((value) => text(value)),
      fc.integer({ min: 1, max: 40 }).map((n) => marker(`GEN-${String(n).padStart(3, '0')}`)),
    );
    const cell = fc.array(inline, { minLength: 1, maxLength: 3 }).map((content) => td(para(...content)));
    const block = fc.oneof(
      fc.array(inline, { minLength: 1, maxLength: 4 }).map((content) => para(...content)),
      fc
        .array(fc.array(cell, { minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 3 })
        .map((rows) => table(row(th(para(text('Title')))), ...rows.map((cells) => row(...cells)))),
    );

    fc.assert(
      fc.property(fc.array(block, { minLength: 1, maxLength: 6 }), (blocks) => {
        const content = doc(...blocks);
        expect(JSON.stringify(index(content))).toEqual(JSON.stringify(index(content)));
      }),
      { numRuns: 120 },
    );
  });

  it('depends only on content: the same subtree indexes the same way wherever it appears', () => {
    const fragment = para(marker('FN-001'), text(' Portable requirement.'));
    const early = index(doc(fragment, para(text('tail'))));
    const late = index(doc(para(text('head')), fragment));

    const strip = (requirement: { anchorPath: string }) => ({ ...requirement, anchorPath: '' });
    expect(early.requirements.map(strip)).toEqual(late.requirements.map(strip));
  });
});
