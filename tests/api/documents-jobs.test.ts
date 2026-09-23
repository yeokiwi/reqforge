import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '@/server/auth/password';
import { createApiToken } from '@/server/repositories/api-tokens';
import { prisma } from '@/server/repositories/client';
import { call } from './support';

/**
 * spec: 08-api-surface.md §3 (documents: `PUT` returns the IndexResult diagnostics — "the
 * headless path RY cannot offer"), §5 (exports) and §6 (jobs).
 */

const tag = `${Date.now() % 1000000}${Math.floor(Math.random() * 1000)}`;
let ownerId = '';
let otherId = '';
let spaceId = '';
let spaceKey = '';
let ownerToken = '';
let otherToken = '';
let documentId = '';

const K = (n: number) => `DJ${tag}-00${n}`;
const text = (value: string) => ({ type: 'text', text: value });
const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const marker = (key: string) => ({ type: 'requirement', attrs: { key, uid: `uid-${key}` } });
const doc = (...content: unknown[]) => ({ type: 'doc', content });

beforeAll(async () => {
  const make = async (name: string) =>
    (await prisma.user.create({ data: { email: `dj-${name}-${tag}@test`, name, passwordHash: await hashPassword('x') } })).id;
  [ownerId, otherId] = await Promise.all([make('owner'), make('other')]);
  spaceKey = `DJ${tag}`.slice(0, 10);
  spaceId = (await prisma.space.create({ data: { key: spaceKey, name: 'Docs and jobs' } })).id;
  await prisma.membership.createMany({
    data: [
      { spaceId, userId: ownerId, permissions: ['VIEW', 'EDIT', 'EXPORT', 'ADMIN'] },
      { spaceId, userId: otherId, permissions: ['VIEW', 'EDIT', 'EXPORT'] },
    ],
  });
  ownerToken = (await createApiToken({ userId: ownerId, name: 'ci', scopes: ['read', 'edit', 'export'], spaceKeys: [] })).token;
  otherToken = (await createApiToken({ userId: otherId, name: 'ci', scopes: ['read', 'edit', 'export'], spaceKeys: [] })).token;
}, 60_000);

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { spaceId } });
  await prisma.job.deleteMany({ where: { spaceId } });
  await prisma.requirementValidation.deleteMany({ where: { requirement: { spaceId } } });
  await prisma.documentLink.deleteMany({ where: { requirement: { spaceId } } });
  await prisma.property.deleteMany({ where: { requirement: { spaceId } } });
  await prisma.requirement.deleteMany({ where: { spaceId } });
  await prisma.requirementType.deleteMany({ where: { spaceId } });
  await prisma.indexDiagnostic.deleteMany({ where: { document: { spaceId } } });
  await prisma.documentViewGate.deleteMany({ where: { document: { spaceId } } });
  await prisma.document.updateMany({ where: { spaceId }, data: { currentVersionId: null } });
  await prisma.documentVersion.deleteMany({ where: { document: { spaceId } } });
  await prisma.document.deleteMany({ where: { spaceId } });
  await prisma.apiToken.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
  await prisma.membership.deleteMany({ where: { spaceId } });
  await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  await prisma.$disconnect();
});

describe('documents over the API', () => {
  it('creates a document, then a PUT indexes it and returns the diagnostics at once', async () => {
    const created = await call('POST', '/spaces/{spaceKey}/documents', { spaceKey }, { token: ownerToken, body: { title: 'Uploaded' } });
    expect(created.status).toBe(201);
    documentId = (created.body as { id: string }).id;

    const put = await call('PUT', '/spaces/{spaceKey}/documents/{id}', { spaceKey, id: documentId }, {
      token: ownerToken,
      body: { content: doc(para(text('The first requirement. '), marker(K(1))), para(text('A bad key. '), marker('x'))), message: 'from CI' },
    });
    expect(put.status).toBe(200);
    const body = put.body as { version: number; requirements: { created: number }; diagnostics: Array<{ code: string; severity: string }>; valid: boolean };
    expect(body.version).toBe(2);
    expect(body.requirements.created).toBe(1);
    // What a CI job checks: the upload's own verdict, in the response (spec 08 §3).
    expect(body.valid).toBe(false);
    expect(body.diagnostics.some((entry) => entry.code === 'KEY_INVALID' && entry.severity === 'error')).toBe(true);

    const listed = await call('GET', '/spaces/{spaceKey}/requirements', { spaceKey }, { token: ownerToken, query: { q: `key = '${K(1)}'` } });
    expect((listed.body as { items: Array<{ key: string }> }).items.map((item) => item.key)).toEqual([K(1)]);

    const diagnostics = await call('GET', '/spaces/{spaceKey}/documents/{id}/diagnostics', { spaceKey, id: documentId }, { token: ownerToken });
    expect((diagnostics.body as { items: Array<{ code: string }> }).items.map((item) => item.code)).toContain('KEY_INVALID');
  });

  it('reads a version as ProseMirror JSON or as HTML', async () => {
    const json = await call('GET', '/spaces/{spaceKey}/documents/{id}', { spaceKey, id: documentId }, { token: ownerToken });
    expect(json.body).toMatchObject({ version: { number: 2, message: 'from CI' }, content: { type: 'doc' } });
    const html = await call('GET', '/spaces/{spaceKey}/documents/{id}', { spaceKey, id: documentId }, {
      token: ownerToken,
      query: { format: 'html', version: '1' },
    });
    expect(html.body).toMatchObject({ version: { number: 1 }, html: expect.any(String) });
  });

  it('reindexes the current version as a job, without writing a new version (RD-070)', async () => {
    // A locked pattern the existing key does not match: only a reindex can notice.
    await prisma.requirementType.create({ data: { spaceId, name: 'Locked', keyPattern: 'ZZ-###', locked: true } });
    const response = await call('POST', '/spaces/{spaceKey}/documents/{id}/reindex', { spaceKey, id: documentId }, { token: ownerToken });
    expect(response.status).toBe(202);
    const job = (response.body as { job: { id: string; state: string; href: string } }).job;
    expect(job.href).toBe(`/api/v1/jobs/${job.id}`);

    const polled = await call('GET', '/jobs/{id}', { id: job.id }, { token: ownerToken });
    expect(polled.body).toMatchObject({ state: 'DONE', progress: 100 });

    const versions = await prisma.documentVersion.count({ where: { documentId } });
    expect(versions).toBe(2);
    const diagnostics = await call('GET', '/spaces/{spaceKey}/documents/{id}/diagnostics', { spaceKey, id: documentId }, { token: ownerToken });
    expect((diagnostics.body as { items: Array<{ code: string }> }).items.map((item) => item.code)).toContain('KEY_NOT_ALLOWED');
  });
});

describe('jobs over the API (spec 08 §6)', () => {
  it('queues an export, reports it DONE, redirects to the artefact and serves the file', async () => {
    const queued = await call('POST', '/spaces/{spaceKey}/exports', { spaceKey }, {
      token: ownerToken,
      body: { kind: 'traceability', config: { query: `key ~ 'DJ${tag}-%'`, columns: [{ kind: 'key' }, { kind: 'title' }] } },
    });
    expect(queued.status).toBe(202);
    const id = (queued.body as { job: { id: string } }).job.id;

    const status = await call('GET', '/jobs/{id}', { id }, { token: ownerToken });
    expect(status.body).toMatchObject({ state: 'DONE', resultHref: `/api/v1/jobs/${id}/result` });

    const result = await call('GET', '/jobs/{id}/result', { id }, { token: ownerToken });
    expect(result.status).toBe(302);
    expect(result.headers.get('location')).toBe(`http://reqforge.test/api/v1/jobs/${id}/artifact`);

    const artifact = await call('GET', '/jobs/{id}/artifact', { id }, { token: ownerToken });
    expect(artifact.status).toBe(200);
    expect(artifact.headers.get('content-type')).toContain('spreadsheetml');

    // The download is audited once — by the artefact, not by the redirect (RD-062).
    expect(await prisma.auditEvent.count({ where: { objectId: id, operation: 'download' } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { objectId: id, operation: 'queue' } })).toBe(1);
  });

  it('hides a job from anyone but the person who queued it (RD-064)', async () => {
    const queued = await call('POST', '/spaces/{spaceKey}/exports', { spaceKey }, {
      token: ownerToken,
      body: { kind: 'dependencies', query: `key ~ 'DJ${tag}-%'` },
    });
    const id = (queued.body as { job: { id: string } }).job.id;
    expect((await call('GET', '/jobs/{id}', { id }, { token: otherToken })).status).toBe(404);
    expect((await call('GET', '/jobs/{id}/result', { id }, { token: otherToken })).status).toBe(404);
    expect((await call('GET', '/jobs/{id}/artifact', { id }, { token: otherToken })).status).toBe(404);
    expect((await call('POST', '/jobs/{id}/cancel', { id }, { token: otherToken })).status).toBe(404);
  });

  it('refuses an unknown export kind at validation', async () => {
    const response = await call('POST', '/spaces/{spaceKey}/exports', { spaceKey }, { token: ownerToken, body: { kind: 'pdf' } });
    expect(response.status).toBe(400);
  });
});

describe('the xlsx the artefact route serves', () => {
  it('is a real workbook', async () => {
    const queued = await call('POST', '/spaces/{spaceKey}/exports', { spaceKey }, {
      token: ownerToken,
      body: { kind: 'traceability', config: { query: `key ~ 'DJ${tag}-%'`, columns: [{ kind: 'key' }] } },
    });
    const id = (queued.body as { job: { id: string } }).job.id;
    const { routesAt } = await import('@/server/api/registry');
    const response = await routesAt('/jobs/{id}/artifact').GET!(
      new Request(`http://reqforge.test/api/v1/jobs/${id}/artifact`, { headers: { Authorization: `Bearer ${ownerToken}` } }),
      { params: Promise.resolve({ id }) },
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    expect(workbook.worksheets.length).toBeGreaterThan(0);
  });
});
