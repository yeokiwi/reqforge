import { describe, expect, it } from 'vitest';
import type { PMNode } from '@/domain/doc';
import {
  DEFAULT_COLUMNS,
  modeOf,
  parseColumns,
  renderReportRows,
  resolveLastRequirement,
  type ReportSource,
} from '../report';

describe('the columns mini-syntax (spec 04 §5)', () => {
  it('uses the documented default when the spec is blank', () => {
    const { columns } = parseColumns('   ');
    expect(columns.map((column) => column.label)).toEqual(['Key', 'Description + Properties', 'Documents']);
    expect(parseColumns(DEFAULT_COLUMNS).columns).toEqual(columns);
  });

  it('separates columns with , and concatenates fields with +', () => {
    const { columns } = parseColumns('key, description+properties, to');
    expect(columns).toHaveLength(3);
    expect(columns[1]!.fields.map((field) => field.name)).toEqual(['description', 'properties']);
  });

  it('accepts every implemented field', () => {
    const { columns, problems } = parseColumns('key, description, properties, status, original, links, to, from');
    expect(problems).toEqual([]);
    expect(columns).toHaveLength(8);
  });

  it('reads a relationship after @ and options after ?', () => {
    const { columns } = parseColumns("to@refines?format=page&li=true&duplicates=false");
    expect(columns[0]!.fields[0]).toEqual({
      name: 'to',
      relationship: 'refines',
      format: 'page',
      li: 'true',
      duplicates: false,
    });
    expect(columns[0]!.label).toBe('Depends on — refines');
  });

  it('defaults the options that are not given', () => {
    expect(parseColumns('key').columns[0]!.fields[0]).toMatchObject({
      relationship: null,
      format: 'short',
      li: 'false',
      duplicates: true,
    });
  });

  it('refuses jira and tests with an explanation, as RD-022 does for RQL', () => {
    const { columns, problems } = parseColumns('key, jira, tests');
    expect(columns.map((column) => column.label)).toEqual(['Key']);
    expect(problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining('Atlassian-specific'),
      expect.stringContaining('testing module'),
    ]);
  });

  it('reports an unknown field and an unusable option rather than crashing', () => {
    const unknown = parseColumns('key, nonsense');
    expect(unknown.problems[0]!.message).toContain('Unknown field "nonsense"');
    expect(unknown.columns.map((column) => column.label)).toEqual(['Key']);

    const badOption = parseColumns('to?format=sideways&li=maybe');
    expect(badOption.problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining('format must be short or page'),
      expect.stringContaining('li must be true, false or last'),
    ]);
    // The field is still usable; the bad options fall back to their defaults.
    expect(badOption.columns[0]!.fields[0]).toMatchObject({ format: 'short', li: 'false' });
  });

  it('falls back to the default when nothing in the spec is usable', () => {
    const { columns, problems } = parseColumns('nonsense, jira');
    expect(columns.map((column) => column.label)).toEqual(['Key', 'Description + Properties', 'Documents']);
    expect(problems).toHaveLength(2);
  });
});

describe('rendering cells (RD-034)', () => {
  const source: ReportSource = {
    key: 'FN-001',
    title: 'The system shall log every access',
    bodyHtml: '<p>The system shall log every access</p>',
    status: 'ACTIVE',
    properties: [
      { name: 'Category', value: 'Safety' },
      { name: 'Category', value: 'Safety' },
      { name: 'Priority', value: 'High' },
    ],
    documents: [{ id: 'doc-1', title: 'Functional specification' }],
    dependencies: [
      { direction: 'to', relationship: 'refines', key: 'BR-001', title: 'Business rule one' },
      { direction: 'to', relationship: 'verifies', key: 'TC-001', title: 'Test case one' },
      { direction: 'from', relationship: 'refines', key: 'FN-900', title: 'Child requirement' },
    ],
  };

  const render = (spec: string) => renderReportRows(parseColumns(spec).columns, [source])[0]!;

  it('renders key, status and description', () => {
    const row = render('key, status, description');
    expect(row.cells.map((cell) => cell.values.map((value) => value.text))).toEqual([
      ['FN-001'],
      ['ACTIVE'],
      ['The system shall log every access'],
    ]);
  });

  it('renders `original` exactly as `description`, because they coincide here', () => {
    expect(render('original').cells[0]).toEqual(render('description').cells[0]);
  });

  it('concatenates fields within one column', () => {
    const row = render('key+status');
    expect(row.cells[0]!.values.map((value) => value.text)).toEqual(['FN-001', 'ACTIVE']);
  });

  it('filters dependencies by direction and relationship', () => {
    expect(render('to').cells[0]!.values.map((value) => value.text)).toEqual(['BR-001', 'TC-001']);
    expect(render('to@refines').cells[0]!.values.map((value) => value.text)).toEqual(['BR-001']);
    expect(render('from').cells[0]!.values.map((value) => value.text)).toEqual(['FN-900']);
  });

  it('format=page shows titles, format=short shows keys', () => {
    expect(render('to?format=page').cells[0]!.values[0]!.text).toBe('BR-001 — Business rule one');
    expect(render('links?format=page').cells[0]!.values[0]!.text).toBe('Functional specification');
    expect(render('links').cells[0]!.values[0]!.text).toBe('doc-1');
  });

  it('li=last keeps only the final value, and duplicates=false removes repeats', () => {
    expect(render('to?li=last').cells[0]!.values.map((value) => value.text)).toEqual(['TC-001']);
    expect(render('properties').cells[0]!.values).toHaveLength(3);
    expect(render('properties?duplicates=false').cells[0]!.values.map((value) => value.text)).toEqual([
      'Category: Safety',
      'Priority: High',
    ]);
  });

  it('keeps the li mode on the cell so the view can render a list', () => {
    expect(render('to?li=true').cells[0]!.li).toBe('true');
    expect(render('to').cells[0]!.li).toBe('false');
  });
});

// ---------------------------------------------------------------- last requirement

const text = (value: string): PMNode => ({ type: 'text', text: value });
const para = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const marker = (key: string): PMNode => ({ type: 'requirement', attrs: { key, uid: `uid-${key}` } });
const link = (key: string): PMNode => ({ type: 'requirementLink', attrs: { key } });
const report = (id: string): PMNode => ({ type: 'report', attrs: { id } });
const td = (...content: PMNode[]): PMNode => ({ type: 'tableCell', content });
const row = (...content: PMNode[]): PMNode => ({ type: 'tableRow', content });
const table = (...content: PMNode[]): PMNode => ({ type: 'table', content });
const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content });

describe('"use the last requirement" (spec 04 §5, RD-035)', () => {
  it('either switch overrides the query, and the definition switch wins', () => {
    expect(modeOf({ useLastRequirement: false, useLastRequirementDefinition: false })).toBe('query');
    expect(modeOf({ useLastRequirement: true, useLastRequirementDefinition: false })).toBe('last');
    expect(modeOf({ useLastRequirement: true, useLastRequirementDefinition: true })).toBe('lastDefinition');
    expect(modeOf({ useLastRequirement: false, useLastRequirementDefinition: true })).toBe('lastDefinition');
  });

  it('`last` takes the nearest preceding marker or link', () => {
    const content = doc(
      para(marker('FN-001'), text(' One.')),
      para(link('BR-050'), text(' A citation.')),
      para(report('r1')),
    );
    expect(resolveLastRequirement(content, 'r1', 'last')).toBe('BR-050');
  });

  it('`lastDefinition` ignores links', () => {
    const content = doc(para(marker('FN-001')), para(link('BR-050')), para(report('r1')));
    expect(resolveLastRequirement(content, 'r1', 'lastDefinition')).toBe('FN-001');
  });

  it('RD-035: a report inside FN-002 row renders FN-001, not itself', () => {
    const content = doc(
      table(
        row(td(para(text('First'))), td(para(marker('FN-001')))),
        row(td(para(text('Second'), report('r1'))), td(para(marker('FN-002')))),
      ),
    );

    expect(resolveLastRequirement(content, 'r1', 'lastDefinition')).toBe('FN-001');
    // Without the definition switch, the nearest preceding marker is the enclosing one.
    expect(resolveLastRequirement(content, 'r1', 'last')).toBe('FN-001');
  });

  it('a report in a paragraph after its own definition resolves to that definition', () => {
    const content = doc(para(marker('FN-001'), text(' One.')), para(report('r1')));
    expect(resolveLastRequirement(content, 'r1', 'lastDefinition')).toBe('FN-001');
  });

  it('a report inside the same paragraph as a definition skips it', () => {
    const content = doc(
      para(marker('FN-001'), text(' One.')),
      para(marker('FN-002'), text(' Two.'), report('r1')),
    );
    expect(resolveLastRequirement(content, 'r1', 'lastDefinition')).toBe('FN-001');
  });

  it('resolves to nothing before any requirement, and in query mode', () => {
    const content = doc(para(report('r1')), para(marker('FN-001')));
    expect(resolveLastRequirement(content, 'r1', 'lastDefinition')).toBeNull();
    expect(resolveLastRequirement(content, 'r1', 'last')).toBeNull();
    expect(resolveLastRequirement(content, 'r1', 'query')).toBeNull();
  });

  it('resolves to nothing when the report is not in this document', () => {
    const content = doc(para(marker('FN-001')), para(report('r1')));
    expect(resolveLastRequirement(content, 'other', 'last')).toBeNull();
  });
});
