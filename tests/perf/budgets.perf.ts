import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import { runWithPrincipal } from '@/server/auth/principal';
import { prisma } from '@/server/repositories/client';
import { createBaselineUseCase, deleteBaselineUseCase, freezeUseCase, listBaselinesUseCase } from '@/server/usecases/baselines';
import { runCoverageUseCase } from '@/server/usecases/coverage';
import { createDocumentUseCase, saveDocumentUseCase } from '@/server/usecases/documents';
import { runMatrixUseCase } from '@/server/usecases/matrix';
import { searchUseCase } from '@/server/usecases/search';
import { measure, writeResults } from './recorder';
import { ensureScaleFixture, PER_SPACE, type ScaleFixture } from './scale-fixture';

/**
 * The performance budget. spec: 07-permissions-and-limits.md §5 — six operations, measured
 * on the fixture dataset, each through its **use case** so authorisation, the visibility
 * predicate and type loading are inside the number, as they are for a person. RD-073.
 *
 * This file records; `scripts/perf-gate.ts` judges (the budgets, and >25% against the
 * recorded baseline). Each operation's result is still checked for correctness, so an
 * error can never pass as a fast answer.
 */

/** Spec 07 §5, verbatim. */
export const BUDGETS = {
  'index-document-100': 300,
  'search-simple-100': 150,
  'search-traversal-100': 400,
  'matrix-page-100x8': 600,
  'coverage-5000': 2_000,
  'freeze-5000': 60_000,
} as const;

/** The eight columns of "matrix page, 100 rows, 8 columns". */
const MATRIX_COLUMNS = [
  { kind: 'key' },
  { kind: 'title' },
  { kind: 'status' },
  { kind: 'document' },
  { kind: 'property', name: 'Category' },
  { kind: 'property', name: 'Priority' },
  { kind: 'external', name: 'Approval' },
  { kind: 'dependency', direction: 'to', relationship: 'refines', depth: 1, render: 'key' },
];

const PROBE_TITLE = 'Index probe (perf)';

let fixture: ScaleFixture;
let user: User;
let buildMs = 0;
const as = <T>(fn: () => Promise<T>): Promise<T> => runWithPrincipal({ kind: 'session', user }, fn);
const space = (index: number): string => fixture.spaces[index]!.key;

beforeAll(async () => {
  const started = performance.now();
  fixture = await ensureScaleFixture(prisma);
  buildMs = performance.now() - started;
  console.log(`  fixture ${fixture.built ? 'built' : 'reused'} in ${Math.round(buildMs)} ms`);
  user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } });
  await clearProbes();
  // The previous run's clean-up deleted thousands of rows. Left to autovacuum, that cleanup
  // lands in the middle of this run's measurements and moved a median by 70% here; settled
  // first, identical runs agree to within a few percent (RD-073).
  for (const table of ['Requirement', 'Property', 'Dependency', 'DocumentLink', 'RequirementValidation', 'DocumentVersion']) {
    await prisma.$executeRawUnsafe(`VACUUM ANALYZE "${table}"`);
  }
}, 1_800_000);

afterAll(async () => {
  await clearProbes();
  writeResults({
    fixture: { spaces: fixture.spaces.length, requirementsPerSpace: PER_SPACE, built: fixture.built, buildMs: Math.round(buildMs) },
    node: process.version,
    at: new Date().toISOString(),
  });
  await prisma.$disconnect();
}, 600_000);

/** Leaves the fixture as it was found: the probe document's rows, and any baseline. */
async function clearProbes(): Promise<void> {
  const probes = await prisma.document.findMany({ where: { title: PROBE_TITLE, spaceId: { in: fixture.spaces.map((s) => s.id) } }, select: { id: true } });
  for (const { id } of probes) {
    const inDoc = `SELECT r.id FROM "Requirement" r JOIN "DocumentVersion" v ON v.id = r."originVersionId" WHERE v."documentId" = $1`;
    for (const table of ['Property', 'DocumentLink', 'RequirementValidation', 'RequirementHistory']) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "requirementId" IN (${inDoc})`, id);
    }
    await prisma.$executeRawUnsafe(`DELETE FROM "Dependency" WHERE "childId" IN (${inDoc}) OR "parentId" IN (${inDoc})`, id);
    await prisma.$executeRawUnsafe(`DELETE FROM "UnresolvedDependency" WHERE "childId" IN (${inDoc})`, id);
    await prisma.$executeRawUnsafe(`DELETE FROM "Requirement" WHERE id IN (${inDoc})`, id);
    await prisma.$executeRawUnsafe(`DELETE FROM "DocumentLink" WHERE "versionId" IN (SELECT id FROM "DocumentVersion" WHERE "documentId" = $1)`, id);
    await prisma.$executeRawUnsafe(`DELETE FROM "IndexDiagnostic" WHERE "documentId" = $1`, id);
    await prisma.$executeRawUnsafe(`UPDATE "Document" SET "currentVersionId" = NULL WHERE id = $1`, id);
    await prisma.$executeRawUnsafe(`DELETE FROM "DocumentVersion" WHERE "documentId" = $1`, id);
    await prisma.$executeRawUnsafe(`DELETE FROM "Document" WHERE id = $1`, id);
  }
  for (const { key } of fixture.spaces) {
    for (const baseline of await as(() => listBaselinesUseCase(key))) {
      await as(() => deleteBaselineUseCase(key, baseline.id));
    }
  }
}

/** A horizontal table of 100 requirements — spec 03 §2's most common layout. */
function probeDocument(spaceKey: string, run: number) {
  const cell = (content: unknown[]) => ({ type: 'tableCell', content: [{ type: 'paragraph', content }] });
  const header = (text: string) => ({ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const rows = Array.from({ length: 100 }, (_, index) => {
    const key = `${spaceKey}X-${String(index + 1).padStart(3, '0')}`;
    return {
      type: 'tableRow',
      content: [
        cell([{ type: 'text', text: `The probe shall hold value ${index} in revision ${run}.` }]),
        cell([{ type: 'text', text: index % 2 === 0 ? 'High' : 'Low' }]),
        cell([{ type: 'requirement', attrs: { key, uid: `probe-${spaceKey}-${index}` } }]),
      ],
    };
  });
  return {
    type: 'doc',
    content: [{ type: 'table', content: [{ type: 'tableRow', content: [header('Title'), header('Priority'), header('Key')] }, ...rows] }],
  };
}

describe('performance budget (spec 07 §5)', () => {
  it('index one document (100 requirements)', async () => {
    const spaceKey = space(0);
    const document = await as(() => createDocumentUseCase({ spaceKey, title: PROBE_TITLE }));
    // Every run is a real edit of all 100 rows, so every run writes 100 updates; the first
    // warm-up is the save that creates them.
    await measure(
      'index-document-100',
      BUDGETS['index-document-100'],
      async (run) => {
        const outcome = await as(() => saveDocumentUseCase({ spaceKey, documentId: document.id, content: probeDocument(spaceKey, run) }));
        expect(outcome.requirements.created + outcome.requirements.updated).toBe(100);
      },
      { runs: 20, warmups: 3 },
    );
  }, 600_000);

  it('search, 100 rows, simple query', async () => {
    await measure('search-simple-100', BUDGETS['search-simple-100'], async () => {
      const result = await as(() => searchUseCase({ spaceKey: space(2), query: "@Category = 'Safety'", limit: 100 }));
      expect(result.ok && result.rows.length).toBe(100);
    });
  }, 600_000);

  it('search, 100 rows, one -> traversal', async () => {
    await measure('search-traversal-100', BUDGETS['search-traversal-100'], async () => {
      const result = await as(() => searchUseCase({ spaceKey: space(2), query: "to -> @Category = 'Safety'", limit: 100 }));
      expect(result.ok && result.rows.length).toBe(100);
    });
  }, 600_000);

  it('traceability matrix page, 100 rows, 8 columns', async () => {
    const spaceKey = space(3);
    await measure('matrix-page-100x8', BUDGETS['matrix-page-100x8'], async () => {
      const result = await as(() =>
        runMatrixUseCase({ spaceKey, config: { query: `key ~ '${spaceKey}-%'`, columns: MATRIX_COLUMNS, pageSize: 100, treeView: false } }),
      );
      expect(result.ok && result.page.rows.length).toBe(100);
    });
  }, 600_000);

  it('coverage over 5,000 requirements', async () => {
    await measure(
      'coverage-5000',
      BUDGETS['coverage-5000'],
      async () => {
        const result = await as(() => runCoverageUseCase({ spaceKey: space(3), query: "@Batch = 'A'" }));
        expect(result.ok && result.population).toBe(PER_SPACE / 2);
      },
      { runs: 20, warmups: 3 },
    );
  }, 600_000);

  it('freeze 5,000 requirements, streaming', async () => {
    const spaceKey = space(4);
    await measure(
      'freeze-5000',
      BUDGETS['freeze-5000'],
      async (run) => {
        const baseline = await as(() => createBaselineUseCase({ spaceKey, name: `Perf freeze ${run}`, query: "@Batch = 'A'" }));
        const job = await as(() => freezeUseCase({ spaceKey, id: baseline.id }));
        // "Streaming": the job reports progress batch by batch and finishes; nothing is held
        // in one request (spec 07 §5, spec 05 §3.2).
        const done = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
        expect(done.state).toBe('DONE');
        expect(done.progress).toBe(100);
        expect(await prisma.requirement.count({ where: { baselineId: baseline.id } })).toBe(PER_SPACE / 2);
      },
      { runs: 1, warmups: 0 },
    );
  }, 1_200_000);
});
