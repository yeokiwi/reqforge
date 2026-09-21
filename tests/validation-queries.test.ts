import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The client must be constructed with query events on, so the env is set before it loads.
process.env.PRISMA_QUERY_EVENTS = '1';

import type { PMNode } from '@/domain/doc';
import type { Rule } from '@/domain/validation';

const { indexDocumentVersion } = await import('@/domain/indexer');
const { prisma } = await import('@/server/repositories/client');
const { hashPassword } = await import('@/server/auth/password');
const { createDocument, saveDocumentVersion } = await import('@/server/repositories/documents');
const { applyIndexResult } = await import('@/server/repositories/requirements');
const { createType, listTypesWithRules, rulesOf, updateType } = await import(
  '@/server/repositories/requirement-types'
);
const { fetchValidationSubjects } = await import('@/server/repositories/validations');

/**
 * Slice 12's acceptance, from PLAN.md: "validating one requirement issues zero extra
 * queries (query-counter test)".
 * spec: 06-requirement-types.md §2.3 — the cost of validation must not grow with the
 * number of requirements being validated. `RD-040` states the reading precisely: one
 * batched query per *document* or per *page*, never one per requirement.
 */

let counting = false;
let queries: string[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(prisma as any).$on('query', (event: { query: string }) => {
  if (!counting) return;
  if (/^\s*(SELECT|WITH|INSERT|UPDATE|DELETE)\b/i.test(event.query)) queries.push(event.query);
});

/** Prisma emits query events asynchronously, so the window is closed explicitly. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

const text = (value: string): PMNode => ({ type: 'text', text: value });
const para = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const marker = (key: string): PMNode => ({ type: 'requirement', attrs: { key, uid: `uid-${key}` } });
const th = (...content: PMNode[]): PMNode => ({ type: 'tableHeader', content });
const td = (...content: PMNode[]): PMNode => ({ type: 'tableCell', content });
const row = (...cells: PMNode[]): PMNode => ({ type: 'tableRow', content: cells });
const table = (...rows: PMNode[]): PMNode => ({ type: 'table', content: rows });
const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content });

const tag = `${Date.now() % 1000000}${Math.floor(Math.random() * 1000)}`;

let spaceId = '';
let spaceKey = '';
let userId = '';

const key = (n: number) => `QC${tag}-${String(n).padStart(4, '0')}`;

/** Every rule kind that reads something, so the measurement covers all of them. */
const RULES: Rule[] = [
  { kind: 'REQUIRED_PROPERTY', name: 'Status' },
  { kind: 'OPTIONAL_PROPERTY', name: 'Rationale' },
  { kind: 'PROPERTY_IN', name: 'Status', values: ['Draft', 'Approved'] },
  { kind: 'PROPERTY_MATCHES', name: 'Status', pattern: '^[A-Z]' },
  { kind: 'REQUIRED_DEPENDENCY', relationship: 'verifies', direction: 'to' },
  { kind: 'REQUIRED_DEPENDENCY', relationship: 'satisfies', direction: 'from' },
];

/**
 * A table of `count` requirement rows, each with a Status the rules can read. Each
 * document owns its own key range: two documents defining the same key would be a rule
 * S3 conflict, and a conflicted requirement is never written or validated.
 */
function documentOf(count: number, offset: number): PMNode {
  const header = row(th(para(text('Title'))), th(para(text('Status'))), th(para(text('Key'))));
  const rows = Array.from({ length: count }, (_, index) =>
    row(
      td(para(text(`Requirement ${index}.`))),
      td(para(text('Draft'))),
      td(para(marker(key(offset + index)))),
    ),
  );
  return doc(table(header, ...rows));
}

async function save(documentId: string, content: PMNode): Promise<void> {
  const types = await listTypesWithRules(spaceId);
  const result = indexDocumentVersion({ content, space: { key: spaceKey, types } });

  await saveDocumentVersion({
    documentId,
    content,
    authorId: userId,
    onVersion: async (tx, version) => {
      await applyIndexResult(tx, {
        spaceId,
        spaceKey,
        documentId,
        versionId: version.id,
        actorId: userId,
        result,
        types: types.map((type) => ({ id: type.id, rules: rulesOf(type) })),
      });
    },
  });
}

/**
 * Statements issued by a save of `count` requirements. The document is saved once
 * outside the window, so the count reflects steady-state work rather than first-save
 * inserts and connection setup.
 */
async function statementsForSave(documentId: string, count: number, offset: number): Promise<number> {
  await save(documentId, documentOf(count, offset));
  await settle();

  queries = [];
  counting = true;
  await save(documentId, documentOf(count, offset));
  await settle();
  counting = false;

  return queries.length;
}

/** Turns the type's rules on or off, so validation's own cost can be isolated. */
async function setRules(on: boolean): Promise<void> {
  const [type] = await listTypesWithRules(spaceId);
  await updateType(spaceId, type!.id, {
    name: type!.name,
    keyPattern: type!.keyPattern,
    colour: type!.colour,
    locked: type!.locked,
    preventReusingDeletedKeys: type!.preventReusingDeletedKeys,
    rules: on ? RULES : [],
    templateColumns: [],
  });
}

/**
 * What validation costs at this size: the difference between saving with rules and
 * saving without. Everything else about the save — the per-requirement upsert the
 * indexer has done since slice 2 — cancels out, which is what makes this a measurement
 * of validation rather than of indexing.
 */
async function validationCost(documentId: string, count: number, offset: number): Promise<number> {
  await setRules(false);
  const without = await statementsForSave(documentId, count, offset);
  await setRules(true);
  const withRules = await statementsForSave(documentId, count, offset);
  return withRules - without;
}

describe('validation issues no query per requirement (spec 06 §2.3)', () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `qc-${tag}@test`, name: 'Counter', passwordHash: await hashPassword('x') },
    });
    userId = user.id;
    spaceKey = `QC${tag}`.slice(0, 10);
    const space = await prisma.space.create({ data: { key: spaceKey, name: 'Query counting' } });
    spaceId = space.id;

    await createType(spaceId, {
      name: 'Counted',
      keyPattern: `QC${tag}-####`,
      colour: '#4a5568',
      locked: false,
      preventReusingDeletedKeys: true,
      rules: RULES,
      templateColumns: [],
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.requirementValidation.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.indexDiagnostic.deleteMany({ where: { document: { spaceId } } });
    await prisma.documentLink.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.property.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.requirement.deleteMany({ where: { spaceId } });
    await prisma.documentVersion.deleteMany({ where: { document: { spaceId } } });
    await prisma.document.deleteMany({ where: { spaceId } });
    await prisma.requirementType.deleteMany({ where: { spaceId } });
    await prisma.space.deleteMany({ where: { id: spaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('validating 100 requirements costs exactly what validating 10 costs', async () => {
    const small = await createDocument({ spaceId, title: 'Ten', parentId: null, authorId: userId });
    const large = await createDocument({ spaceId, title: 'Hundred', parentId: null, authorId: userId });

    const forTen = await validationCost(small.id, 10, 0);
    const forHundred = await validationCost(large.id, 100, 1000);

    // The acceptance check: ten times the requirements, and validation costs the same.
    expect(forHundred).toBe(forTen);
    // And what it costs is a small constant: one SELECT for the inbound edges (RD-040),
    // plus the delete and the insert that replace the cached results.
    expect(forTen).toBeLessThanOrEqual(3);
  }, 120_000);

  it('a page of the revalidation job costs three queries however large the page is', async () => {
    const rows = await prisma.requirement.findMany({
      where: { spaceId },
      select: { id: true, key: true, anchorPath: true },
      orderBy: { upperKey: 'asc' },
    });
    expect(rows.length).toBeGreaterThan(100);

    // Warm up, then count each page size.
    await fetchValidationSubjects(rows.slice(0, 5));
    await settle();

    const count = async (size: number) => {
      queries = [];
      counting = true;
      const subjects = await fetchValidationSubjects(rows.slice(0, size));
      await settle();
      counting = false;
      expect(subjects).toHaveLength(size);
      return queries.length;
    };

    // One for properties, one for outbound edges, one for inbound — spec 06 §2.3.
    expect(await count(10)).toBe(3);
    expect(await count(100)).toBe(3);
  }, 120_000);
});
