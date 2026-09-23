import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import { LimitExceededError } from '@/domain/errors';
import { hashPassword } from '@/server/auth/password';
import { runWithPrincipal } from '@/server/auth/principal';
import { installationLimits, limitsOf } from '@/server/limits';
import { createApiToken } from '@/server/repositories/api-tokens';
import { prisma } from '@/server/repositories/client';
import { createBaselineUseCase, freezeUseCase } from '@/server/usecases/baselines';
import { runDiff } from '@/server/usecases/diff';
import { createDocumentUseCase, saveDocumentUseCase } from '@/server/usecases/documents';
import { exportDependencyMatrixUseCase } from '@/server/usecases/jobs';
import { setSpaceLimitsUseCase } from '@/server/usecases/limits';
import { runMatrixUseCase } from '@/server/usecases/matrix';
import { previewRenameUseCase } from '@/server/usecases/rename';
import { createTypeUseCase } from '@/server/usecases/requirement-types';
import { call } from './api/support';
import { dropSpace } from './perf/scale-fixture';

/**
 * spec: 07-permissions-and-limits.md §4 — "Exceeding a hard limit is an error with the
 * limit named in the message. Exceeding a warning threshold is a diagnostic, not a block."
 * RD-071, RD-072.
 *
 * Every limit is exercised through a *lowered* per-space override, which is the other half
 * of what is under test (configurable per space) and keeps each case to a handful of rows.
 */

const tag = `${Date.now() % 1000000}${Math.floor(Math.random() * 1000)}`;
const spaceKey = `LM${tag}`.slice(0, 12);
let spaceId = '';
let admin: User;
let author: User;

const text = (value: string) => ({ type: 'text', text: value });
const marker = (key: string) => ({ type: 'requirement', attrs: { key, uid: `uid-${key}` } });
const doc = (...keys: string[]) => ({ type: 'doc', content: keys.map((key) => ({ type: 'paragraph', content: [text(`The system shall ${key}. `), marker(key)] })) });
const K = (n: number, prefix = 'LM') => `${prefix}${tag}-${String(n).padStart(3, '0')}`;

const asAuthor = <T>(fn: () => Promise<T>) => runWithPrincipal({ kind: 'session', user: author }, fn);
const asAdmin = <T>(fn: () => Promise<T>) => runWithPrincipal({ kind: 'session', user: admin }, fn);
const setLimits = (overrides: Record<string, number>) => asAdmin(() => setSpaceLimitsUseCase(spaceKey, overrides));

async function newDocument(title: string) {
  return asAuthor(() => createDocumentUseCase({ spaceKey, title }));
}

async function versionsOf(documentId: string): Promise<number> {
  return prisma.documentVersion.count({ where: { documentId } });
}

beforeAll(async () => {
  const passwordHash = await hashPassword('x');
  admin = await prisma.user.create({ data: { email: `lm-admin-${tag}@test`, name: 'Admin', passwordHash, isAdmin: true } });
  author = await prisma.user.create({ data: { email: `lm-author-${tag}@test`, name: 'Author', passwordHash } });
  spaceId = (await prisma.space.create({ data: { key: spaceKey, name: 'Limits' } })).id;
  await prisma.membership.create({ data: { spaceId, userId: author.id, permissions: ['VIEW', 'EDIT', 'EXPORT', 'ADMIN'] } });
}, 60_000);

beforeEach(async () => {
  await setLimits({});
});

afterAll(async () => {
  await dropSpace(prisma, spaceId);
  await prisma.apiToken.deleteMany({ where: { userId: { in: [admin.id, author.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, author.id] } } });
  await prisma.$disconnect();
});

describe('requirements per document (spec 07 §4, RD-072)', () => {
  it('refuses a save over the limit before anything is written, naming the limit', async () => {
    await setLimits({ requirementsPerDocument: 3, requirementsPerDocumentWarning: 2 });
    const document = await newDocument('Too long');
    const save = asAuthor(() => saveDocumentUseCase({ spaceKey, documentId: document.id, content: doc(K(1), K(2), K(3), K(4)) }));
    await expect(save).rejects.toThrow(LimitExceededError);
    await expect(save).rejects.toThrow('"Requirements per document" limit exceeded: this document has 4 requirements; the limit is 3.');
    expect(await versionsOf(document.id)).toBe(1);
    expect(await prisma.requirement.count({ where: { spaceId, key: { in: [K(1), K(2), K(3), K(4)] } } })).toBe(0);
  });

  it('above the warning threshold saves, with a DOCUMENT_LARGE warning', async () => {
    await setLimits({ requirementsPerDocument: 3, requirementsPerDocumentWarning: 2 });
    const document = await newDocument('Long');
    const outcome = await asAuthor(() => saveDocumentUseCase({ spaceKey, documentId: document.id, content: doc(K(5), K(6), K(7)) }));
    expect(outcome.requirements.created).toBe(3);
    expect(outcome.diagnostics).toContainEqual(expect.objectContaining({ code: 'DOCUMENT_LARGE', severity: 'warning' }));
    // Stored like every other diagnostic, so the editor shows it after a reload.
    expect(await prisma.indexDiagnostic.count({ where: { documentId: document.id, code: 'DOCUMENT_LARGE' } })).toBe(1);
  });

  it('refuses more types in one document than the limit', async () => {
    await asAuthor(() => createTypeUseCase(spaceKey, { name: 'A', keyPattern: `TA${tag}-###`, colour: '', locked: false, preventReusingDeletedKeys: false, rules: [], templateColumns: [] }));
    await asAuthor(() => createTypeUseCase(spaceKey, { name: 'B', keyPattern: `TB${tag}-###`, colour: '', locked: false, preventReusingDeletedKeys: false, rules: [], templateColumns: [] }));
    await setLimits({ typesPerDocument: 1 });
    const document = await newDocument('Two types');
    await expect(
      asAuthor(() => saveDocumentUseCase({ spaceKey, documentId: document.id, content: doc(K(1, 'TA'), K(1, 'TB')) })),
    ).rejects.toThrow('"Types applying to one document" limit exceeded');
    await expect(asAuthor(() => saveDocumentUseCase({ spaceKey, documentId: document.id, content: doc(K(1, 'TA'), K(2, 'TA')) }))).resolves.toBeDefined();
  });

});

describe('requirements per space (spec 07 §4, RD-072)', () => {
  it('refuses a save that would take the space over, and rolls the whole save back', async () => {
    const live = await prisma.requirement.count({ where: { spaceId, baselineId: null, status: { not: 'DELETED' } } });
    await setLimits({ requirementsPerSpace: live + 2 });
    const document = await newDocument('Growing');
    await expect(
      asAuthor(() => saveDocumentUseCase({ spaceKey, documentId: document.id, content: doc(K(21), K(22), K(23)) })),
    ).rejects.toThrow(`"Requirements per space" limit exceeded: this save would bring the space to ${live + 3} requirements; the limit is ${live + 2}.`);
    expect(await versionsOf(document.id)).toBe(1);
    expect(await prisma.requirement.count({ where: { spaceId, key: { in: [K(21), K(22), K(23)] } } })).toBe(0);
  });

  it('still lets an over-limit space be edited and shrunk', async () => {
    const document = await newDocument('Shrinking');
    await asAuthor(() => saveDocumentUseCase({ spaceKey, documentId: document.id, content: doc(K(31), K(32)) }));
    const live = await prisma.requirement.count({ where: { spaceId, baselineId: null, status: { not: 'DELETED' } } });
    await setLimits({ requirementsPerSpace: live - 1 });
    // The same two requirements, reworded: no growth, so allowed.
    await expect(asAuthor(() => saveDocumentUseCase({ spaceKey, documentId: document.id, content: doc(K(31), K(32)) }))).resolves.toBeDefined();
    await expect(asAuthor(() => saveDocumentUseCase({ spaceKey, documentId: document.id, content: doc(K(31)) }))).resolves.toBeDefined();
    // Growing again is refused.
    await expect(asAuthor(() => saveDocumentUseCase({ spaceKey, documentId: document.id, content: doc(K(31), K(32), K(33)) }))).rejects.toThrow(
      LimitExceededError,
    );
  });
});

describe('the other hard limits, each named (spec 07 §4)', () => {
  it('requirements per baseline, reported as "more than"', async () => {
    const document = await newDocument('Baseline source');
    await asAuthor(() => saveDocumentUseCase({ spaceKey, documentId: document.id, content: doc(K(41), K(42), K(43)) }));
    await setLimits({ requirementsPerBaseline: 2 });
    const baseline = await asAuthor(() => createBaselineUseCase({ spaceKey, name: 'Too big', query: `key ~ '${spaceKey}-04%'` }));
    await expect(asAuthor(() => freezeUseCase({ spaceKey, id: baseline.id }))).rejects.toThrow(
      '"Requirements per baseline" limit exceeded: that query selects more than 2 requirements; the limit is 2.',
    );
  });

  it('requirements compared interactively in a diff', async () => {
    await setLimits({ diffInteractiveMax: 2 });
    await expect(asAuthor(() => runDiff({ spaceKey, request: { left: `key ~ '${spaceKey}-%'`, right: `key ~ '${spaceKey}-%'` } }))).rejects.toThrow(
      /"Requirements compared interactively" limit exceeded: that comparison covers \d+ requirements, so it runs as an export; the limit is 2\./,
    );
  });

  it('matrix page size: asking for more is refused, not silently clamped', async () => {
    await setLimits({ matrixPageSizeMax: 50 });
    await expect(asAuthor(() => runMatrixUseCase({ spaceKey, config: { query: `key ~ '${spaceKey}-%'`, pageSize: 60 } }))).rejects.toThrow(
      '"Matrix page size" limit exceeded: a page of 60 rows was requested; the limit is 50.',
    );
    await expect(asAuthor(() => runMatrixUseCase({ spaceKey, config: { query: `key ~ '${spaceKey}-%'`, pageSize: 50 } }))).resolves.toMatchObject({ ok: true });
  });

  it('requirements per rename', async () => {
    await setLimits({ renameRequirements: 1 });
    await expect(
      asAuthor(() => previewRenameUseCase({ spaceKey, pairs: [{ from: K(41), to: K(91) }, { from: K(42), to: K(92) }] })),
    ).rejects.toThrow('"Requirements per rename" limit exceeded: this rename covers 2 requirements; the limit is 1.');
  });

  it('rules per requirement type', async () => {
    await setLimits({ rulesPerType: 1 });
    await expect(
      asAuthor(() =>
        createTypeUseCase(spaceKey, {
          name: 'Ruled',
          keyPattern: `RU${tag}-###`,
          colour: '',
          locked: false,
          preventReusingDeletedKeys: false,
          rules: [{ kind: 'REQUIRED_PROPERTY', name: 'Owner' }, { kind: 'REQUIRED_PROPERTY', name: 'Risk' }],
          templateColumns: [],
        }),
      ),
    ).rejects.toThrow('"Rules per requirement type" limit exceeded: this type has 2 rules; the limit is 1.');
  });

  it('dependency matrix export axis: the job fails with the named limit', async () => {
    await setLimits({ dependencyExportAxis: 2 });
    const job = await asAuthor(() => exportDependencyMatrixUseCase({ spaceKey, query: `key ~ '${spaceKey}-%'` }));
    const done = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.state).toBe('FAILED');
    expect(done.error).toMatch(/^"Dependency matrix export axis" limit exceeded: that query matches \d+ requirements; the limit is 2\.$/);
  });
});

describe('the API answers a limit as a problem (spec 08 §1)', () => {
  it('PUT over the per-document limit is 422 with limitName, limit and actual', async () => {
    await setLimits({ requirementsPerDocument: 2, requirementsPerDocumentWarning: 1 });
    const { token } = await createApiToken({ userId: author.id, name: 'ci', scopes: ['read', 'edit'], spaceKeys: [] });
    const document = await newDocument('Uploaded');
    const put = await call('PUT', '/spaces/{spaceKey}/documents/{id}', { spaceKey, id: document.id }, {
      token,
      body: { content: doc(K(61), K(62), K(63)) },
    });
    expect(put.status).toBe(422);
    expect(put.body).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      title: 'Limit exceeded',
      limitName: 'requirementsPerDocument',
      limit: 2,
      actual: 3,
      detail: '"Requirements per document" limit exceeded: this document has 3 requirements; the limit is 2.',
    });
  });
});

describe('who may set limits (RD-071)', () => {
  it('only an instance administrator, only from a session, and it is audited', async () => {
    await expect(asAuthor(() => setSpaceLimitsUseCase(spaceKey, { rulesPerType: 5 }))).rejects.toThrow(/instance administrator/);
    await expect(
      runWithPrincipal({ kind: 'token', user: admin, tokenId: 'x', scopes: ['admin'], spaceKeys: [] }, () => setSpaceLimitsUseCase(spaceKey, { rulesPerType: 5 })),
    ).rejects.toThrow(/API token/);

    await setLimits({ rulesPerType: 5 });
    const audit = await prisma.auditEvent.findFirst({ where: { spaceId, operation: 'limits.update' }, orderBy: { at: 'desc' } });
    expect(audit?.parameters).toMatchObject({ after: { rulesPerType: 5 } });
  });

  it('refuses what the override class does not allow, and writes nothing', async () => {
    await setLimits({ rulesPerType: 5 });
    await expect(setLimits({ matrixPageSizeMax: 601 })).rejects.toThrow(/may be lowered but not raised/);
    await expect(setLimits({ traversalDepth: 3 })).rejects.toThrow(/fixed at 4/);
    await expect(setLimits({ nonsense: 3 })).rejects.toThrow(/is not a limit/);
    const space = await prisma.space.findUniqueOrThrow({ where: { id: spaceId } });
    expect(space.limits).toEqual({ rulesPerType: 5 });
  });
});

describe('installation limits (REQFORGE_LIMITS)', () => {
  it('sit between the spec defaults and the space overrides', async () => {
    const previous = process.env.REQFORGE_LIMITS;
    try {
      process.env.REQFORGE_LIMITS = JSON.stringify({ requirementsPerSpace: 20_000, rulesPerType: 10 });
      expect(installationLimits()).toEqual({ requirementsPerSpace: 20_000, rulesPerType: 10 });
      expect(limitsOf({ limits: { rulesPerType: 3 } })).toMatchObject({ requirementsPerSpace: 20_000, rulesPerType: 3, requirementsPerBaseline: 12_000 });
      process.env.REQFORGE_LIMITS = '{not json';
      expect(() => installationLimits()).toThrow('REQFORGE_LIMITS is not valid JSON.');
      process.env.REQFORGE_LIMITS = JSON.stringify({ diffRows: 900 });
      expect(() => installationLimits()).toThrow(/may be lowered but not raised/);
    } finally {
      if (previous === undefined) delete process.env.REQFORGE_LIMITS;
      else process.env.REQFORGE_LIMITS = previous;
    }
  });
});
