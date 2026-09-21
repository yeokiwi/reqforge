import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aggregateValues } from '@/domain/properties/external';
import { parseAndAnalyse } from '@/domain/ryql';
import { columnId, type MatrixColumn } from '@/domain/traceability/matrix';
import { prisma } from '@/server/repositories/client';
import {
  fetchValuesFor,
  loadExternalTypes,
  setValueForRequirements,
} from '@/server/repositories/external-properties';
import { groupIdsOf, runSearchIds, visibilityPredicate } from '@/server/repositories/search';
import { runMatrixForUser } from '@/server/usecases/matrix';
import { createCorpusSpace, dropCorpusSpace, type FixtureHandles } from './fixtures/corpus-space';

/**
 * External properties where the rest of the application meets them: the matrix column,
 * its aggregate, and a bulk set that covers a whole result set rather than a page.
 * spec: 04-traceability-and-coverage.md §2.1–2.2; RD-037, RD-038, RD-039
 */

let fixture: FixtureHandles;

const approval: MatrixColumn = { kind: 'external', name: 'Approval', editable: true };
const risk = (aggregate?: 'sum' | 'avg' | 'min' | 'max' | 'count'): MatrixColumn => ({
  kind: 'external',
  name: 'RiskScore',
  editable: true,
  ...(aggregate ? { aggregate } : {}),
});

const run = async (columns: MatrixColumn[], query = "key ~ '%'", pageSize = 100) => {
  const result = await runMatrixForUser({
    space: { id: fixture.spaceId, key: fixture.spaceKey, isolated: false },
    userId: fixture.userId,
    config: { query, columns, pageSize, treeView: false },
  });
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
  return result;
};

const populationOf = async (query: string) => {
  const analysed = parseAndAnalyse(query, {
    spaceKey: fixture.spaceKey,
    isolated: false,
    externalTypes: await loadExternalTypes(),
  });
  if (!analysed.ok) throw new Error(analysed.errors[0]?.message);
  return runSearchIds(analysed.query.expr, {
    visibility: visibilityPredicate(fixture.userId, await groupIdsOf(fixture.userId)),
    externalTypes: await loadExternalTypes(),
  });
};

beforeAll(async () => {
  fixture = await createCorpusSpace(prisma);
}, 120_000);

afterAll(async () => {
  await dropCorpusSpace(prisma, fixture);
  await prisma.$disconnect();
});

describe('external columns in the matrix (spec 04 §2.1–2.2)', () => {
  it('hands the screen the definition behind each external column', async () => {
    const result = await run([{ kind: 'key' }, approval, risk('sum')]);

    expect(result.definitions.map((definition) => definition.searchName).sort()).toEqual(['approval', 'riskscore']);
    const enumerated = result.definitions.find((definition) => definition.searchName === 'approval');
    expect(enumerated?.dataType).toBe('ENUM');
    expect(enumerated?.enumValues).toEqual(['Pending', 'Signed off']);
  });

  it('sends no definitions when the config has no external column', async () => {
    const result = await run([{ kind: 'key' }, { kind: 'property', name: 'Category' }]);
    expect(result.definitions).toEqual([]);
  });

  it('computes the column aggregate from the values on the page', async () => {
    const result = await run([{ kind: 'key' }, risk('sum')], "key ~ '%'", 100);
    const values = result.page.rows.map((row) => row.cells[columnId(risk('sum'))]?.text ?? '');

    // The fixture gives every fiftieth requirement a score; the rest are blank.
    const present = values.filter((value) => value.length > 0);
    expect(present.length).toBeGreaterThan(0);

    const total = present.reduce((left, right) => left + Number(right), 0);
    expect(aggregateValues('sum', 'NUMBER', values)).toEqual({ ok: true, text: String(total) });
    expect(aggregateValues('count', 'NUMBER', values)).toEqual({ ok: true, text: String(present.length) });
  });

  it('refuses sum on a column whose property is not numeric, rather than showing NaN', async () => {
    const result = await run([{ kind: 'key' }, approval]);
    const values = result.page.rows.map((row) => row.cells[columnId(approval)]?.text ?? '');
    expect(aggregateValues('sum', 'ENUM', values)).toMatchObject({ ok: false });
  });

  it('a typed query finds the rows the column shows (RD-037)', async () => {
    const above = await populationOf('ext@RiskScore > 3');
    const all = await populationOf('ext@RiskScore IS NOT NULL');
    expect(above.length).toBeGreaterThan(0);
    expect(above.length).toBeLessThan(all.length);

    const values = await fetchValuesFor(above, [fixture.riskDefinitionId]);
    expect(values.every((value) => Number(value.value) > 3)).toBe(true);
  });

  it('orders a NUMBER property numerically, not as text', async () => {
    // '10' > '9' as text, '10' < '9' is false as a number: the guard is a value above 9.
    const target = await populationOf('ext@RiskScore > 9');
    expect(target).toEqual([]);
  });
});

describe('setting a value in bulk (spec 04 §2.2, RD-039)', () => {
  it('covers the whole result set, not just the first page', async () => {
    const query = "key ~ 'FN-%'";
    const population = await populationOf(query);
    expect(population.length).toBeGreaterThan(100);

    const written = await setValueForRequirements({
      requirementIds: population,
      definition: { id: fixture.approvalDefinitionId, name: 'Approval', searchName: 'approval' },
      value: 'Pending',
    });
    expect(written).toBe(population.length);

    // Every row in the population now carries it — including ones far past a page.
    const values = await fetchValuesFor(population, [fixture.approvalDefinitionId]);
    expect(values).toHaveLength(population.length);
    expect(values.every((value) => value.value === 'Pending')).toBe(true);

    const page = await run([{ kind: 'key' }, approval], query, 10);
    expect(page.page.total).toBe(population.length);
    expect(page.page.rows.every((row) => row.cells[columnId(approval)]?.text === 'Pending')).toBe(true);
  });

  it('a bulk clear removes every value it set', async () => {
    const population = await populationOf("key ~ 'FN-%'");
    await setValueForRequirements({
      requirementIds: population,
      definition: { id: fixture.approvalDefinitionId, name: 'Approval', searchName: 'approval' },
      value: null,
    });
    expect(await fetchValuesFor(population, [fixture.approvalDefinitionId])).toEqual([]);
  });

  it('reaches only rows the caller could have listed (rule X3)', async () => {
    // The stranger cannot see the restricted document, so its requirements are not in the
    // population they would bulk-set — the predicate does that, not a later filter.
    const analysed = parseAndAnalyse("key ~ '%'", { spaceKey: fixture.spaceKey, isolated: false });
    if (!analysed.ok) throw new Error('query should parse');

    const mine = await runSearchIds(analysed.query.expr, {
      visibility: visibilityPredicate(fixture.userId, await groupIdsOf(fixture.userId)),
    });
    const theirs = await runSearchIds(analysed.query.expr, {
      visibility: visibilityPredicate(fixture.strangerId, await groupIdsOf(fixture.strangerId)),
    });

    expect(theirs.length).toBeLessThan(mine.length);
    expect(theirs.every((id) => mine.includes(id))).toBe(true);
  });
});
