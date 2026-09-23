import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '@/server/auth/password';
import { SESSION_COOKIE, sealSessionId } from '@/server/auth/session';
import { createApiToken, revokeApiToken } from '@/server/repositories/api-tokens';
import { prisma } from '@/server/repositories/client';
import { createSession } from '@/server/repositories/sessions';
import { runWithPrincipal } from '@/server/auth/principal';
import { createGroupUseCase } from '@/server/usecases/groups';
import { call } from './support';

/**
 * API authentication. spec: 08-api-surface.md §1; RD-065 (scopes: the intersection of the
 * token and its owner's live permissions), RD-069 (cookie writes are same-origin only).
 */

const tag = `${Date.now() % 1000000}${Math.floor(Math.random() * 1000)}`;
let ownerId = '';
let spaceId = '';
let otherSpaceId = '';
let spaceKey = '';
let otherKey = '';
let documentId = '';
let cookie = '';

const TREE = '/spaces/{spaceKey}/documents';
const DOC = '/spaces/{spaceKey}/documents/{id}';
const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body.' }] }] };

const token = async (scopes: Array<'read' | 'edit' | 'export' | 'admin'>, spaceKeys: string[] = []) =>
  (await createApiToken({ userId: ownerId, name: `t-${scopes.join('-')}`, scopes, spaceKeys })).token;

beforeAll(async () => {
  const owner = await prisma.user.create({
    data: { email: `api-${tag}@test`, name: 'Owner', passwordHash: await hashPassword('x'), isAdmin: true },
  });
  ownerId = owner.id;
  spaceKey = `AA${tag}`.slice(0, 10);
  otherKey = `AB${tag}`.slice(0, 10);
  spaceId = (await prisma.space.create({ data: { key: spaceKey, name: 'API' } })).id;
  otherSpaceId = (await prisma.space.create({ data: { key: otherKey, name: 'Other' } })).id;
  for (const id of [spaceId, otherSpaceId]) {
    await prisma.membership.create({ data: { spaceId: id, userId: ownerId, permissions: ['VIEW', 'EDIT', 'EXPORT', 'ADMIN'] } });
  }
  const created = await prisma.document.create({ data: { spaceId, title: 'Doc' } });
  const version = await prisma.documentVersion.create({ data: { documentId: created.id, number: 1, content: doc, authorId: ownerId } });
  await prisma.document.update({ where: { id: created.id }, data: { currentVersionId: version.id } });
  documentId = created.id;

  const sessionId = randomBytes(24).toString('base64url');
  await createSession(sessionId, ownerId, new Date(Date.now() + 3_600_000));
  cookie = `${SESSION_COOKIE}=${sealSessionId(sessionId)}`;
}, 60_000);

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { OR: [{ spaceId: { in: [spaceId, otherSpaceId] } }, { actorId: ownerId }] } });
  await prisma.group.deleteMany({ where: { name: { startsWith: `api-${tag}` } } });
  await prisma.indexDiagnostic.deleteMany({ where: { documentId } });
  await prisma.documentViewGate.deleteMany({ where: { documentId } });
  await prisma.document.update({ where: { id: documentId }, data: { currentVersionId: null } });
  await prisma.documentVersion.deleteMany({ where: { documentId } });
  await prisma.document.deleteMany({ where: { id: documentId } });
  await prisma.membership.deleteMany({ where: { spaceId: { in: [spaceId, otherSpaceId] } } });
  await prisma.space.deleteMany({ where: { id: { in: [spaceId, otherSpaceId] } } });
  await prisma.session.deleteMany({ where: { userId: ownerId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
  await prisma.$disconnect();
});

describe('who is calling', () => {
  it('refuses a request with no credentials, as a problem document', async () => {
    const response = await call('GET', TREE, { spaceKey });
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(response.body).toMatchObject({ status: 401, code: 'NOT_AUTHENTICATED', title: 'Not authenticated' });
  });

  it('refuses a malformed, a forged and a revoked token alike, and never falls back to the cookie', async () => {
    expect((await call('GET', TREE, { spaceKey }, { token: 'rf_nope' })).status).toBe(401);
    const real = await token(['read']);
    const forged = real.replace(/_[^_]+$/, `_${'x'.repeat(43)}`);
    expect((await call('GET', TREE, { spaceKey }, { token: forged })).status).toBe(401);

    const revoked = await createApiToken({ userId: ownerId, name: 'soon gone', scopes: ['read'], spaceKeys: [] });
    expect((await call('GET', TREE, { spaceKey }, { token: revoked.token })).status).toBe(200);
    await revokeApiToken(ownerId, revoked.view.id);
    const after = await call('GET', TREE, { spaceKey }, { token: revoked.token, headers: { cookie } });
    expect(after.status).toBe(401);
  });

  it('accepts the session cookie for reads', async () => {
    expect((await call('GET', TREE, { spaceKey }, { headers: { cookie } })).status).toBe(200);
  });

  it('refuses a cookie-authenticated write from another origin, or with none (RD-069)', async () => {
    const body = { content: doc };
    const none = await call('PUT', DOC, { spaceKey, id: documentId }, { body, headers: { cookie } });
    expect(none.status).toBe(403);
    const foreign = await call('PUT', DOC, { spaceKey, id: documentId }, { body, headers: { cookie, origin: 'https://evil.example' } });
    expect(foreign.status).toBe(403);
    const own = await call('PUT', DOC, { spaceKey, id: documentId }, { body, headers: { cookie, origin: 'http://reqforge.test' } });
    expect(own.status).toBe(200);
  });
});

describe('what a token may do (RD-065)', () => {
  it('a read token reads, and is refused a write', async () => {
    const read = await token(['read']);
    expect((await call('GET', DOC, { spaceKey, id: documentId }, { token: read })).status).toBe(200);
    const write = await call('PUT', DOC, { spaceKey, id: documentId }, { token: read, body: { content: doc } });
    expect(write.status).toBe(403);
    expect(write.body).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('an edit token writes, and a bearer write needs no Origin', async () => {
    const edit = await token(['read', 'edit']);
    const response = await call('PUT', DOC, { spaceKey, id: documentId }, { token: edit, body: { content: doc } });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ valid: true });
  });

  it('a token confined to one space finds no other — 404, never 403', async () => {
    const confined = await token(['read'], [spaceKey]);
    expect((await call('GET', TREE, { spaceKey }, { token: confined })).status).toBe(200);
    expect((await call('GET', TREE, { spaceKey: otherKey }, { token: confined })).status).toBe(404);
  });

  it('loses what its owner loses', async () => {
    const full = await token(['read', 'edit', 'export', 'admin']);
    await prisma.membership.updateMany({ where: { spaceId: otherSpaceId, userId: ownerId }, data: { permissions: [] } });
    try {
      expect((await call('GET', TREE, { spaceKey: otherKey }, { token: full })).status).toBe(404);
    } finally {
      await prisma.membership.updateMany({
        where: { spaceId: otherSpaceId, userId: ownerId },
        data: { permissions: ['VIEW', 'EDIT', 'EXPORT', 'ADMIN'] },
      });
    }
  });

  it('never acts as an instance administrator, even when its owner is one', async () => {
    const admin = await token(['read', 'edit', 'export', 'admin']);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    await expect(
      runWithPrincipal({ kind: 'token', user, tokenId: 'x', scopes: ['admin'], spaceKeys: [] }, () =>
        createGroupUseCase(`api-${tag}-nope`),
      ),
    ).rejects.toThrow(/token/i);
    // …while the same person, signed in, may.
    await runWithPrincipal({ kind: 'session', user }, () => createGroupUseCase(`api-${tag}-ok`));
    expect(admin).toMatch(/^rf_/);
  });
});

describe('request validation', () => {
  it('answers a malformed body with 400 and the issues', async () => {
    const edit = await token(['read', 'edit']);
    const response = await call('PUT', DOC, { spaceKey, id: documentId }, { token: edit, body: { content: { type: 'paragraph' } } });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'BAD_REQUEST' });
    expect((response.body as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
  });

  it('serves the OpenAPI document without credentials', async () => {
    const response = await call('GET', '/openapi.json', {});
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ openapi: '3.1.0' });
  });
});
