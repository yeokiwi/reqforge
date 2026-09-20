import { describe, expect, it } from 'vitest';
import { indexDocumentVersion } from '..';
import { doc, marker, para, row, table, td, text, th } from './fixtures';
import type { PMNode } from '@/domain/doc';

const space = { key: 'SJ' };
const index = (content: PMNode) => indexDocumentVersion({ content, space });

const config = (attrs: Record<string, unknown>): PMNode => ({ type: 'propertyConfig', attrs });
const list = (...items: string[]): PMNode => ({
  type: 'bulletList',
  content: items.map((item) => ({ type: 'listItem', content: [para(text(item))] })),
});

describe('inline properties (spec 03 §1.3, §3.1)', () => {
  const standard = doc(
    table(
      row(th(para(text('Title'))), th(para(text('Category'))), th(para(text('Priority'))), th(para(text('Key')))),
      row(
        td(para(text('The system shall log every access.'))),
        td(para(text('Security'))),
        td(para(text('High'))),
        td(para(marker('FN-001'))),
      ),
    ),
  );

  it('makes one property per column, named by the header', () => {
    const result = index(standard);
    expect(result.properties.map((property) => [property.name, property.value])).toEqual([
      ['Category', 'Security'],
      ['Priority', 'High'],
    ]);
    expect(result.properties[0]).toMatchObject({ key: 'FN-001', searchName: 'category', valueOrdinal: 0, valueIndex: 0 });
  });

  it('uses the first column as the title and does not repeat it as a property', () => {
    const result = index(standard);
    expect(result.requirements[0]!.title).toBe('The system shall log every access.');
    expect(result.properties.map((property) => property.name)).not.toContain('Title');
  });

  it('the marker-only column produces no property', () => {
    expect(index(standard).properties.map((property) => property.name)).not.toContain('Key');
  });

  it('R3: a list cell becomes one row per member, so `=` is set membership', () => {
    const result = index(
      doc(
        table(
          row(th(para(text('Title'))), th(para(text('Tags'))), th(para(text('Key')))),
          row(td(para(text('Log access'))), td(list('safety', 'security')), td(para(marker('FN-002')))),
        ),
      ),
    );

    const tags = result.properties.filter((property) => property.name === 'Tags');
    expect(tags.map((property) => property.value)).toEqual(['safety', 'security']);
    expect(tags.map((property) => property.valueIndex)).toEqual([0, 1]);
    expect(new Set(tags.map((property) => property.valueOrdinal))).toEqual(new Set([0]));
  });

  it('propertyConfig renames a column, marks the title and ignores a column', () => {
    const result = index(
      doc(
        table(
          row(
            th(para(text('Ref'))),
            th(config({ name: 'Statement', isTitle: true }), para(text('Statement'))),
            th(config({ name: 'Main Category' }), para(text('Category'))),
            th(config({ ignored: true }), para(text('Notes'))),
          ),
          row(
            td(para(marker('FN-003'))),
            td(para(text('The system shall alert.'))),
            td(para(text('Safety'))),
            td(para(text('internal chatter'))),
          ),
        ),
      ),
    );

    expect(result.requirements[0]!.title).toBe('The system shall alert.');
    expect(result.properties.map((property) => property.name)).toEqual(['Main Category']);
    expect(result.properties[0]!.value).toBe('Safety');
    expect(result.requirements[0]!.bodySearch).toBe('The system shall alert.');
  });

  it('warns about a property name containing a space but still indexes it (RD-011)', () => {
    const result = index(
      doc(
        table(
          row(th(para(text('Title'))), th(para(text('Main Category'))), th(para(text('Key')))),
          row(td(para(text('Log access'))), td(para(text('Safety'))), td(para(marker('FN-004')))),
        ),
      ),
    );

    const warning = result.diagnostics.find((d) => d.code === 'PROPERTY_NAME_NOT_SEARCHABLE');
    expect(warning?.severity).toBe('warning');
    expect(warning?.message).toContain("@'Main Category'");
    expect(result.properties[0]).toMatchObject({ name: 'Main Category', searchName: 'main category' });
  });

  it('vertical layout: the row headers name the properties', () => {
    const result = index(
      doc(
        table(
          row(th(para(text('Title'))), td(para(text('Log every access')))),
          row(th(para(text('Category'))), td(para(text('Security')))),
          row(th(para(text('Key'))), td(para(marker('VR-010')))),
        ),
      ),
    );

    expect(result.requirements[0]!.title).toBe('Log every access');
    expect(result.properties.map((property) => [property.name, property.value])).toEqual([['Category', 'Security']]);
  });

  it('RD-027: `text` excludes property values, but a paragraph keeps its whole text', () => {
    expect(index(standard).requirements[0]!.bodySearch).toBe('The system shall log every access.');
    // The excerpt still renders everything, for the popup.
    expect(index(standard).requirements[0]!.bodyHtml).toContain('Security');

    const paragraph = index(doc(para(marker('PR-001'), text(' A plain requirement with no columns.'))));
    expect(paragraph.requirements[0]!.bodySearch).toBe('A plain requirement with no columns.');
  });

  it('a headerless table has no properties at all (rule S4)', () => {
    const result = index(
      doc(table(row(td(para(text('Log access'))), td(para(text('Security'))), td(para(marker('FN-005')))))),
    );
    expect(result.properties).toEqual([]);
    expect(result.requirements[0]!.bodySearch).toContain('Security');
  });
});
