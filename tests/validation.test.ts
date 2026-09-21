import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PMNode } from '@/domain/doc';
import { indexDocumentVersion } from '@/domain/indexer';
import { parseAndAnalyse } from '@/domain/ryql';
import type { Rule } from '@/domain/validation';
import { hashPassword } from '@/server/auth/password';
import { prisma } from '@/server/repositories/client';
import { createDocument, saveDocumentVersion } from '@/server/repositories/documents';
import { applyIndexResult } from '@/server/repositories/requirements';
import { createType, listTypesWithRules, rulesOf, updateType } from '@/server/repositories/requirement-types';
import { groupIdsOf, runSearchIds, visibilityPredicate } from '@/server/repositories/search';

/**
 * Validation on index, and what `ruleStatus` finds afterwards.
 * spec: 06-requirement-types.md §2; 02 §4 (`ruleStatus`); RD-040, RD-041, RD-042
 */

const text = (value: string): PMNode => ({ type: 'text', text: value });
const para = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const marker = (key: string): PMNode => ({ type: 'requirement', attrs: { key, uid: `uid-${key}` } });
const link = (key: string): PMNode => ({ type: 'requirementLink', attrs: { key } });
const th = (...content: PMNode[]): PMNode => ({ type: 'tableHeader', content });
const td = (...content: PMNode[]): PMNode => ({ type: 'tableCell', content });
const row = (...cells: PMNode[]): PMNode => ({ type: 'tableRow', content: cells });
const table = (...rows: PMNode[]): PMNode => ({ type: 'table', content: rows });
const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content });

const tag = `${Date.now() % 1000000}${Math.floor(Math.random() * 1000)}`;

let spaceId = '';
let spaceKey = '';
let userId = '';
let typeId = '';

async function saveAndIndex(documentId: string, content: PMNode) {
  const types = await listTypesWithRules(spaceId);
  const result = indexDocumentVersion({
    content,
    space: { key: spaceKey, types: types.map((type) => ({ ...type, name: type.name })) },
  });

  let diagnostics: Awaited<ReturnType<typeof applyIndexResult>>['diagnostics'] = [];
  await saveDocumentVersion({
    documentId,
    content,
    authorId: userId,
    onVersion: async (tx, version) => {
      const outcome = await applyIndexResult(tx, {
        spaceId,
        spaceKey,
        documentId,
        versionId: version.id,
        actorId: userId,
        result,
        types: types.map((type) => ({ id: type.id, rules: rulesOf(type) })),
      });
      diagnostics = outcome.diagnostics;
    },
  });
  return diagnostics;
}

async function setRules(rules: Rule[]) {
  await updateType(spaceId, typeId, {
    name: 'Functional',
    keyPattern: `VL${tag}-###`,
    colour: '#4a5568',
    locked: false,
    preventReusingDeletedKeys: true,
    rules,
    templateColumns: [],
  });
}

const key = (n: number) => `VL${tag}-${String(n).padStart(3, '0')}`;

/** A one-row table: Title | Status | Key, so the requirement has named properties. */
const requirementRow = (n: number, status?: string, links: PMNode[] = []) =>
  table(
    row(th(para(text('Title'))), th(para(text('Status'))), th(para(text('verifies'))), th(para(text('Key')))),
    row(
      td(para(text(`Requirement ${n}.`))),
      td(para(status ? text(status) : text(''))),
      td(para(...links)),
      td(para(marker(key(n)))),
    ),
  );

async function statusOf(requirementKey: string) {
  const requirement = await prisma.requirement.findFirstOrThrow({ where: { spaceId, upperKey: requirementKey } });
  return prisma.requirementValidation.findFirst({ where: { requirementId: requirement.id } });
}

async function keysMatching(query: string): Promise<string[]> {
  const analysed = parseAndAnalyse(query, { spaceKey, isolated: false });
  if (!analysed.ok) throw new Error(analysed.errors[0]?.message);
  const ids = await runSearchIds(analysed.query.expr, {
    visibility: visibilityPredicate(userId, await groupIdsOf(userId)),
  });
  const rows = await prisma.requirement.findMany({ where: { id: { in: ids } }, select: { key: true } });
  return rows.map((requirement) => requirement.key).sort();
}

describe('validation on index (spec 06 §2.2 trigger 1)', () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `val-${tag}@test`, name: 'Validator', passwordHash: await hashPassword('x') },
    });
    userId = user.id;
    spaceKey = `VL${tag}`.slice(0, 10);
    const space = await prisma.space.create({ data: { key: spaceKey, name: 'Validation' } });
    spaceId = space.id;
    await prisma.membership.create({
      data: { spaceId, userId, permissions: ['VIEW', 'EDIT', 'EXPORT', 'ADMIN'] },
    });

    const type = await createType(spaceId, {
      name: 'Functional',
      keyPattern: `VL${tag}-###`,
      colour: '#4a5568',
      locked: false,
      preventReusingDeletedKeys: true,
      rules: [],
      templateColumns: [],
    });
    typeId = type.id;
  });

  afterAll(async () => {
    await prisma.requirementValidation.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.indexDiagnostic.deleteMany({ where: { document: { spaceId } } });
    await prisma.documentLink.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.$executeRawUnsafe(
      'DELETE FROM "Dependency" WHERE "childId" IN (SELECT id FROM "Requirement" WHERE "spaceId" = $1)',
      spaceId,
    );
    await prisma.property.deleteMany({ where: { requirement: { spaceId } } });
    await prisma.requirement.deleteMany({ where: { spaceId } });
    await prisma.documentVersion.deleteMany({ where: { document: { spaceId } } });
    await prisma.document.deleteMany({ where: { spaceId } });
    await prisma.requirementType.deleteMany({ where: { spaceId } });
    await prisma.membership.deleteMany({ where: { spaceId } });
    await prisma.space.deleteMany({ where: { id: spaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('writes a TRUE row when a requirement satisfies every rule', async () => {
    await setRules([{ kind: 'REQUIRED_PROPERTY', name: 'Status' }]);
    const document = await createDocument({ spaceId, title: 'Passing', parentId: null, authorId: userId });
    await saveAndIndex(document.id, doc(requirementRow(1, 'Draft')));

    const validation = await statusOf(key(1).toUpperCase());
    expect(validation?.status).toBe('TRUE');
    expect(validation?.typeId).toBe(typeId);
  });

  it('writes a FALSE row and returns the diagnostic the editor shows', async () => {
    await setRules([{ kind: 'REQUIRED_PROPERTY', name: 'Priority' }]);
    const document = await createDocument({ spaceId, title: 'Failing', parentId: null, authorId: userId });
    const diagnostics = await saveAndIndex(document.id, doc(requirementRow(2, 'Draft')));

    expect(await statusOf(key(2).toUpperCase()).then((row) => row?.status)).toBe('FALSE');
    const missing = diagnostics.find((diagnostic) => diagnostic.code === 'MISSING_REQUIRED_PROPERTY');
    expect(missing?.key).toBe(key(2));
    // RD-042 — the fix travels with the diagnostic.
    expect(missing?.fix).toMatchObject({ kind: 'addColumn', name: 'Priority', layout: 'HORIZONTAL_TABLE' });
  });

  it('persists the fix, so a reopened document still offers it (RD-042)', async () => {
    const stored = await prisma.indexDiagnostic.findFirst({
      where: { code: 'MISSING_REQUIRED_PROPERTY', key: key(2) },
    });
    expect(stored?.fix).toMatchObject({ kind: 'addColumn', name: 'Priority' });
  });

  it('is findable by ruleStatus, which had nothing to read until now (spec 02 §4)', async () => {
    expect(await keysMatching("ruleStatus = 'false'")).toContain(key(2));
    expect(await keysMatching("ruleStatus = 'true'")).not.toContain(key(2));
    // The qualifier accepts a name as well as an id.
    expect(await keysMatching("ruleStatus@Functional = 'false'")).toContain(key(2));
  });

  it('turns FALSE into TRUE on the save that fixes it', async () => {
    const document = await prisma.document.findFirstOrThrow({ where: { spaceId, title: 'Failing' } });
    await saveAndIndex(
      document.id,
      doc(
        table(
          row(th(para(text('Title'))), th(para(text('Priority'))), th(para(text('Key')))),
          row(td(para(text('Requirement 2.'))), td(para(text('High'))), td(para(marker(key(2))))),
        ),
      ),
    );
    expect(await statusOf(key(2).toUpperCase()).then((row) => row?.status)).toBe('TRUE');
    expect(await keysMatching("ruleStatus = 'false'")).not.toContain(key(2));
  });

  it('WARNING for a missing optional property, not FALSE (spec 06 §2.1)', async () => {
    await setRules([{ kind: 'OPTIONAL_PROPERTY', name: 'Rationale' }]);
    const document = await createDocument({ spaceId, title: 'Optional', parentId: null, authorId: userId });
    await saveAndIndex(document.id, doc(requirementRow(3, 'Draft')));
    expect(await statusOf(key(3).toUpperCase()).then((row) => row?.status)).toBe('WARNING');
  });

  it('PROPERTY_IN fails a value outside the list and offers the dropdown (RD-015, RD-041)', async () => {
    await setRules([{ kind: 'PROPERTY_IN', name: 'Status', values: ['Draft', 'Approved'] }]);
    const document = await createDocument({ spaceId, title: 'Enumerated', parentId: null, authorId: userId });
    const diagnostics = await saveAndIndex(document.id, doc(requirementRow(4, 'Sort of done')));

    expect(await statusOf(key(4).toUpperCase()).then((row) => row?.status)).toBe('FALSE');
    const failure = diagnostics.find((diagnostic) => diagnostic.code === 'PROPERTY_NOT_IN_VALUES');
    expect(failure?.fix).toMatchObject({ kind: 'setCellValue', values: ['Draft', 'Approved'] });
  });

  it('a `from` dependency rule reads an edge declared in another document (RD-040)', async () => {
    await setRules([{ kind: 'REQUIRED_DEPENDENCY', relationship: 'verifies', direction: 'from' }]);

    const target = await createDocument({ spaceId, title: 'Verified', parentId: null, authorId: userId });
    await saveAndIndex(target.id, doc(requirementRow(5, 'Draft')));
    // Nothing points at it yet.
    expect(await statusOf(key(5).toUpperCase()).then((row) => row?.status)).toBe('FALSE');

    // A *different* document declares the edge, in a column named for the relationship.
    const verifier = await createDocument({ spaceId, title: 'Verifier', parentId: null, authorId: userId });
    await saveAndIndex(verifier.id, doc(requirementRow(6, 'Draft', [link(key(5))])));

    // Re-saving the target now sees the inbound edge — the one batched query of RD-040.
    await saveAndIndex(target.id, doc(requirementRow(5, 'Draft')));
    expect(await statusOf(key(5).toUpperCase()).then((row) => row?.status)).toBe('TRUE');
  });

  it('clears a stale row when a requirement stops matching the type', async () => {
    await setRules([{ kind: 'REQUIRED_PROPERTY', name: 'Status' }]);
    const document = await createDocument({ spaceId, title: 'Retyped', parentId: null, authorId: userId });
    await saveAndIndex(document.id, doc(requirementRow(7, 'Draft')));
    expect(await statusOf(key(7).toUpperCase())).not.toBeNull();

    // The same scope, a key matching no pattern: the requirement keeps its row and loses
    // its type, so its validation row must go with it.
    await saveAndIndex(
      document.id,
      doc(
        table(
          row(th(para(text('Title'))), th(para(text('Status'))), th(para(text('Key')))),
          row(td(para(text('Requirement 7.'))), td(para(text('Draft'))), td(para(marker(`OTHER${tag}-007`)))),
        ),
      ),
    );

    const retyped = await prisma.requirement.findFirstOrThrow({
      where: { spaceId, upperKey: `OTHER${tag}-007`.toUpperCase() },
    });
    expect(retyped.typeId).toBeNull();
    expect(await prisma.requirementValidation.findFirst({ where: { requirementId: retyped.id } })).toBeNull();
  });

  it('leaves a requirement of an untyped key alone rather than failing every rule', async () => {
    await setRules([{ kind: 'REQUIRED_PROPERTY', name: 'Impossible' }]);
    const document = await createDocument({ spaceId, title: 'Untyped', parentId: null, authorId: userId });
    await saveAndIndex(document.id, doc(para(marker(`ZZ${tag}-1`), text(' No type matches this key.'))));

    const untyped = await prisma.requirement.findFirstOrThrow({
      where: { spaceId, upperKey: `ZZ${tag}-1`.toUpperCase() },
    });
    expect(untyped.typeId).toBeNull();
    expect(await prisma.requirementValidation.findFirst({ where: { requirementId: untyped.id } })).toBeNull();
  });
});
