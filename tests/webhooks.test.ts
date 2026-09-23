import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PMNode } from '@/domain/doc';
import { ValidationError } from '@/domain/errors';
import { indexDocumentVersion } from '@/domain/indexer';
import { verifySignature } from '@/domain/webhook-signature';
import { MAX_ATTEMPTS, RETRY_DELAYS_MS, type WebhookPayload } from '@/domain/webhooks';
import { hashPassword } from '@/server/auth/password';
import { runWithPrincipal } from '@/server/auth/principal';
import { prisma } from '@/server/repositories/client';
import { createDocument, saveDocumentVersion } from '@/server/repositories/documents';
import { renameRequirements } from '@/server/repositories/rename';
import { applyIndexResult } from '@/server/repositories/requirements';
import { createWebhook } from '@/server/repositories/webhooks';
import { deliverDueWebhooks } from '@/server/webhooks/deliver';
import { createWebhookUseCase, redeliverUseCase, setWebhookResolver } from '@/server/usecases/webhooks';

/**
 * Webhooks. spec: 08-api-surface.md §7; RD-066 (thin payloads), RD-067 (outbox in the
 * change's transaction, HMAC signature, retry schedule, dead letter). No test here touches
 * the network or a real resolver: both are injected.
 */

const tag = `${Date.now() % 1000000}${Math.floor(Math.random() * 1000)}`;
const K = (n: number) => `WH${tag}-00${n}`;
const text = (value: string): PMNode => ({ type: 'text', text: value });
const para = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const marker = (key: string): PMNode => ({ type: 'requirement', attrs: { key, uid: `uid-${key}` } });
const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content });

let userId = '';
let spaceId = '';
let spaceKey = '';
let documentId = '';
let webhookId = '';
let secret = '';

const publicResolver = async () => ['93.184.216.34'];
type Sent = { url: string; headers: Record<string, string>; body: string };

function receiver(status: number) {
  const sent: Sent[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    return new Response(null, { status });
  };
  return { sent, fetcher };
}

async function save(content: PMNode) {
  const result = indexDocumentVersion({ content, space: { key: spaceKey } });
  await saveDocumentVersion({
    documentId,
    content,
    authorId: userId,
    onVersion: async (tx, version) => {
      await applyIndexResult(tx, { spaceId, spaceKey, documentId, versionId: version.id, actorId: userId, result });
    },
  });
}

const pending = async () =>
  prisma.webhookDelivery.findMany({
    where: { webhookId, state: 'PENDING' },
    include: { event: true },
    orderBy: { createdAt: 'asc' },
  });

const clearDeliveries = async () => {
  await prisma.webhookDelivery.deleteMany({ where: { webhookId } });
  await prisma.webhookEvent.deleteMany({ where: { spaceId } });
};

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email: `wh-${tag}@test`, name: 'Hooks', passwordHash: await hashPassword('x') } })).id;
  spaceKey = `WH${tag}`.slice(0, 10);
  spaceId = (await prisma.space.create({ data: { key: spaceKey, name: 'Webhooks' } })).id;
  await prisma.membership.create({ data: { spaceId, userId, permissions: ['VIEW', 'EDIT', 'EXPORT', 'ADMIN'] } });
  documentId = (await createDocument({ spaceId, title: 'Hooked', parentId: null, authorId: userId })).id;
  const hook = await createWebhook({ spaceId, url: 'https://receiver.example/hook', events: [], createdById: userId });
  webhookId = hook.id;
  secret = hook.secret;
  setWebhookResolver(publicResolver);
}, 60_000);

afterAll(async () => {
  await prisma.webhook.deleteMany({ where: { spaceId } });
  await prisma.webhookEvent.deleteMany({ where: { spaceId } });
  await prisma.auditEvent.deleteMany({ where: { spaceId } });
  await prisma.requirementKeyAlias.deleteMany({ where: { spaceId } });
  await prisma.requirementHistory.deleteMany({ where: { spaceId } });
  await prisma.documentLink.deleteMany({ where: { requirement: { spaceId } } });
  await prisma.requirement.deleteMany({ where: { spaceId } });
  await prisma.indexDiagnostic.deleteMany({ where: { documentId } });
  await prisma.documentViewGate.deleteMany({ where: { documentId } });
  await prisma.document.update({ where: { id: documentId }, data: { currentVersionId: null } });
  await prisma.documentVersion.deleteMany({ where: { documentId } });
  await prisma.document.deleteMany({ where: { id: documentId } });
  await prisma.membership.deleteMany({ where: { spaceId } });
  await prisma.space.deleteMany({ where: { id: spaceId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('what a save emits', () => {
  it('writes created and document.indexed, thin, into the outbox', async () => {
    await clearDeliveries();
    await save(doc(para(text('The secret title words. '), marker(K(1)))));
    const rows = await pending();
    expect(rows.map((row) => row.event.type).sort()).toEqual(['document.indexed', 'requirement.created']);

    const created = rows.find((row) => row.event.type === 'requirement.created')!.event.payload as WebhookPayload;
    expect(created).toMatchObject({ type: 'requirement.created', space: spaceKey, key: K(1), recordId: `${spaceKey}/${K(1)}/current`, actorId: userId });
    // RD-066 — identifiers only: the requirement's words never leave in a push.
    expect(JSON.stringify(rows.map((row) => row.event.payload))).not.toMatch(/secret title words/);
  });

  it('stays quiet about a requirement when a save changed nothing about it', async () => {
    await clearDeliveries();
    await save(doc(para(text('The secret title words. '), marker(K(1)))));
    expect((await pending()).map((row) => row.event.type)).toEqual(['document.indexed']);
  });

  it('emits updated for a real change, and deleted for a removed marker', async () => {
    await clearDeliveries();
    await save(doc(para(text('Different words now. '), marker(K(1))), para(text('Another. '), marker(K(2)))));
    expect((await pending()).map((row) => row.event.type).sort()).toEqual(['document.indexed', 'requirement.created', 'requirement.updated']);

    await clearDeliveries();
    await save(doc(para(text('Different words now. '), marker(K(1)))));
    const types = (await pending()).map((row) => `${row.event.type}:${(row.event.payload as WebhookPayload).key ?? ''}`).sort();
    expect(types).toEqual(['document.indexed:', `requirement.deleted:${K(2)}`]);
  });

  it('emits requirement.renamed with the previous key, and nothing when the rename rolls back', async () => {
    await clearDeliveries();
    await expect(
      renameRequirements(
        { spaceId, spaceKey, actorId: userId, pairs: [{ from: K(1), to: `${spaceKey}R-1` }] },
        {
          progress: async (_percent, message) => {
            if (message.includes('documents rewritten')) throw new Error('induced');
          },
        },
      ),
    ).rejects.toThrow('induced');
    // RD-067 — the outbox is in the rename's transaction: rolled back with it.
    expect(await pending()).toEqual([]);

    await renameRequirements({ spaceId, spaceKey, actorId: userId, pairs: [{ from: K(1), to: `${spaceKey}R-1` }] });
    const renamed = (await pending()).find((row) => row.event.type === 'requirement.renamed');
    expect(renamed?.event.payload).toMatchObject({ key: `${spaceKey}R-1`, data: { previousKey: K(1) } });
  });

  it('delivers only the event types a subscription asked for', async () => {
    await clearDeliveries();
    const narrow = await createWebhook({ spaceId, url: 'https://narrow.example/hook', events: ['requirement.deleted'], createdById: userId });
    try {
      await save(doc(para(text('Changed again. '), marker(`${spaceKey}R-1`))));
      expect(await prisma.webhookDelivery.count({ where: { webhookId: narrow.id } })).toBe(0);
      expect(await prisma.webhookDelivery.count({ where: { webhookId } })).toBeGreaterThan(0);
    } finally {
      await prisma.webhook.delete({ where: { id: narrow.id } });
    }
  });
});

describe('delivery (RD-067)', () => {
  it('signs every request so the receiver can verify it with the secret', async () => {
    const { sent, fetcher } = receiver(204);
    const report = await deliverDueWebhooks({ fetcher, resolver: publicResolver });
    expect(report.delivered).toBeGreaterThan(0);
    expect(report.delivered).toBe(sent.length);
    for (const request of sent) {
      const timestamp = request.headers['X-Reqforge-Timestamp']!;
      expect(verifySignature(secret, timestamp, request.body, request.headers['X-Reqforge-Signature']!)).toBe(true);
      // A body altered in transit fails the check.
      expect(verifySignature(secret, timestamp, request.body.replace('"', "'"), request.headers['X-Reqforge-Signature']!)).toBe(false);
    }
    expect(await pending()).toEqual([]);
  });

  it('retries a failing receiver on the schedule, then marks the delivery dead', async () => {
    await clearDeliveries();
    await save(doc(para(text('One more change. '), marker(`${spaceKey}R-1`))));
    const { fetcher } = receiver(500);
    let now = new Date();
    const clock = () => now;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await deliverDueWebhooks({ fetcher, resolver: publicResolver, now: clock });
      const rows = await prisma.webhookDelivery.findMany({ where: { webhookId } });
      for (const row of rows) {
        expect(row.attempt).toBe(attempt);
        expect(row.lastStatus).toBe(500);
        if (attempt < MAX_ATTEMPTS) {
          expect(row.state).toBe('PENDING');
          expect(row.nextAttemptAt.getTime() - now.getTime()).toBe(RETRY_DELAYS_MS[attempt - 1]);
        } else {
          expect(row.state).toBe('DEAD');
        }
      }
      // Nothing is due before its time.
      expect((await deliverDueWebhooks({ fetcher, resolver: publicResolver, now: clock })).attempted).toBe(0);
      now = new Date(now.getTime() + (RETRY_DELAYS_MS[attempt - 1] ?? 0) + 1);
    }
  });

  it('sends a dead delivery again from the dead-letter view', async () => {
    const dead = await prisma.webhookDelivery.findFirstOrThrow({ where: { webhookId, state: 'DEAD' } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await runWithPrincipal({ kind: 'session', user }, () => redeliverUseCase(spaceKey, dead.id));
    const { fetcher } = receiver(200);
    await deliverDueWebhooks({ fetcher, resolver: publicResolver });
    expect((await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: dead.id } })).state).toBe('DELIVERED');
  });

  it('refuses to deliver to a host that has come to resolve to a private address', async () => {
    await clearDeliveries();
    await save(doc(para(text('Yet another. '), marker(`${spaceKey}R-1`))));
    const { sent, fetcher } = receiver(200);
    await deliverDueWebhooks({ fetcher, resolver: async () => ['127.0.0.1'] });
    expect(sent).toEqual([]);
    const rows = await prisma.webhookDelivery.findMany({ where: { webhookId } });
    expect(rows.every((row) => row.state === 'PENDING' && /not a public address/.test(row.lastError ?? ''))).toBe(true);
  });
});

describe('subscribing', () => {
  it('refuses a URL that points inside the network, and returns the secret once', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const as = <T>(work: () => Promise<T>) => runWithPrincipal({ kind: 'session', user }, work);

    await expect(as(() => createWebhookUseCase(spaceKey, { url: 'http://169.254.169.254/latest', events: [] }))).rejects.toBeInstanceOf(ValidationError);
    await expect(as(() => createWebhookUseCase(spaceKey, { url: 'ftp://receiver.example/', events: [] }))).rejects.toBeInstanceOf(ValidationError);
    await expect(as(() => createWebhookUseCase(spaceKey, { url: 'https://receiver.example/', events: ['nope'] }))).rejects.toBeInstanceOf(ValidationError);

    const created = await as(() => createWebhookUseCase(spaceKey, { url: 'https://receiver.example/two', events: ['baseline.frozen'] }));
    expect(created.secret).toMatch(/^whsec_/);
    expect(await prisma.auditEvent.count({ where: { objectId: created.id, operation: 'create' } })).toBe(1);
    await prisma.webhook.delete({ where: { id: created.id } });
  });
});
