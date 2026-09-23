import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { PMNode } from '@/domain/doc';
import type { ReportConfig } from '@/domain/traceability/report';
import { prisma } from '@/server/repositories/client';
import {
  createCorpusSpace,
  dropCorpusSpace,
  keyOf,
  type FixtureHandles,
} from './fixtures/corpus-space';

let fixture: FixtureHandles;
let actor: 'user' | 'stranger' = 'user';

vi.mock('@/server/authz', () => ({
  requireSpace: async () => ({
    user: { id: actor === 'stranger' ? fixture.strangerId : fixture.userId },
    space: { id: fixture.spaceId, key: fixture.spaceKey, isolated: false, classification: null },
    permissions: ['VIEW'],
    can: () => true,
    viewer: { userId: actor === 'stranger' ? fixture.strangerId : fixture.userId, groupIds: [] },
  }),
}));

const { renderReportUseCase } = await import('@/server/usecases/report');

const config = (overrides: Partial<ReportConfig> = {}): ReportConfig => ({
  query: '',
  columns: '',
  countOnly: false,
  useLastRequirement: false,
  useLastRequirementDefinition: false,
  ...overrides,
});

/** The document a "last requirement" report lives in. */
const text = (value: string): PMNode => ({ type: 'text', text: value });
const para = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const marker = (key: string): PMNode => ({ type: 'requirement', attrs: { key, uid: `uid-${key}` } });
const report = (id: string): PMNode => ({ type: 'report', attrs: { id } });

let documentId = '';

beforeAll(async () => {
  fixture = await createCorpusSpace(prisma);

  const document = await prisma.document.create({
    data: { spaceId: fixture.spaceId, title: 'Report host' },
  });
  const content = {
    type: 'doc',
    content: [
      para(marker(keyOf(0)), text(' The first requirement.')),
      para(marker(keyOf(1)), text(' The second requirement.'), report('inside')),
      para(report('after')),
    ],
  };
  const version = await prisma.documentVersion.create({
    data: {
      documentId: document.id,
      number: 1,
      content: content as unknown as Prisma.InputJsonValue,
      authorId: fixture.userId,
    },
  });
  await prisma.document.update({ where: { id: document.id }, data: { currentVersionId: version.id } });
  documentId = document.id;
}, 120_000);

afterAll(async () => {
  await prisma.documentVersion.deleteMany({ where: { documentId } });
  await prisma.document.deleteMany({ where: { id: documentId } });
  await dropCorpusSpace(prisma, fixture);
  await prisma.$disconnect();
});

const render = (reportId: string, overrides: Partial<ReportConfig> = {}) =>
  renderReportUseCase({
    spaceKey: fixture.spaceKey,
    documentId,
    reportId,
    config: config(overrides),
  });

describe('rendering a report (spec 04 §5)', () => {
  it('renders the default columns over a query', async () => {
    const result = await render('after', { query: "key = 'FN-001'" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.columns.map((column) => column.label)).toEqual([
      'Key',
      'Description + Properties',
      'Documents',
    ]);
    expect(result.rows).toHaveLength(1);
    const [key, description, documents] = result.rows[0]!.cells;
    expect(key!.values[0]!.text).toBe('FN-001');
    expect(description!.values.map((value) => value.text)).toContain('Category: Functional');
    expect(documents!.values[0]!.text).toBeTruthy();
  });

  it('renders dependency fields, filtered by relationship', async () => {
    const result = await render('after', { query: "key = 'FN-001'", columns: 'key, to@refines, from' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // FN-001 refines BR-001 (invariant P1), and nothing depends on FN-001.
    expect(result.rows[0]!.cells[1]!.values.map((value) => value.text)).toEqual(['BR-001']);
    expect(result.rows[0]!.cells[2]!.values).toEqual([]);
  });

  it('countOnly renders a number and no rows', async () => {
    const result = await render('after', { query: "key ~ 'FN-0%'", countOnly: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.countOnly).toBe(true);
    expect(result.rows).toEqual([]);
    expect(result.total).toBeGreaterThan(1);
  });

  it('reports a column problem while still rendering the rest', async () => {
    const result = await render('after', { query: "key = 'FN-001'", columns: 'key, jira' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.problems[0]!.message).toContain('Atlassian-specific');
    expect(result.columns.map((column) => column.label)).toEqual(['Key']);
  });

  it('refuses a report with neither a query nor a last-requirement option', async () => {
    const result = await render('after');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.message).toContain('needs a query');
  });

  it('surfaces an invalid query as a query error', async () => {
    const result = await render('after', { query: 'stats = ACTIVE' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe('UNKNOWN_FIELD');
  });
});

describe('"use the last requirement" against a real document (RD-035)', () => {
  it('a report inside a requirement renders the previous definition', async () => {
    const result = await render('inside', {
      query: "key ~ 'BR-%'", // ignored
      useLastRequirementDefinition: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolvedKey).toBe(keyOf(0));
    expect(result.rows.map((row) => row.key)).toEqual([keyOf(0)]);
  });

  it('the plain switch takes the nearest preceding marker', async () => {
    const result = await render('after', { useLastRequirement: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolvedKey).toBe(keyOf(1));
  });

  it('says so when there is no requirement before the report', async () => {
    const result = await render('missing', { useLastRequirement: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([]);
    expect(result.problems[0]!.message).toContain('no requirement before this report');
  });
});

describe('a report never shows what its reader could not search (rule X3)', () => {
  it('omits rows from a restricted document', async () => {
    actor = 'user';
    const owner = await render('after', { query: "key ~ 'BR-1%'", columns: 'key' });
    actor = 'stranger';
    const stranger = await render('after', { query: "key ~ 'BR-1%'", columns: 'key' });
    actor = 'user';

    expect(owner.ok && stranger.ok).toBe(true);
    if (!owner.ok || !stranger.ok) return;

    expect(owner.rows.map((row) => row.key)).toContain('BR-101');
    expect(stranger.rows.map((row) => row.key)).not.toContain('BR-101');
    expect(stranger.total).toBeLessThan(owner.total);
  });

  it('rule X2: a dependency on a hidden requirement shows the key, not its title', async () => {
    actor = 'stranger';
    const result = await render('after', { query: "key = 'FN-101'", columns: 'key, to?format=page' });
    actor = 'user';

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]!.cells[1]!.values[0]!.text).toBe('BR-101 — restricted');
  });
});
