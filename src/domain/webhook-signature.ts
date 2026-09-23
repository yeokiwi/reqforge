/**
 * Webhook request signing. spec: 08-api-surface.md §7 ("HMAC-signed"); RD-067. Server-only:
 * it needs `node:crypto`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * `X-Reqforge-Signature: v1=<hex>` over `<timestamp>.<body>`. The timestamp is signed so a
 * captured request cannot be replayed later with a fresh `X-Reqforge-Timestamp`.
 */
export function signPayload(secret: string, timestamp: string, body: string): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/** What a receiver runs. Exported so the tests — and the docs — use the real thing. */
export function verifySignature(secret: string, timestamp: string, body: string, header: string): boolean {
  const expected = Buffer.from(signPayload(secret, timestamp, body));
  const presented = Buffer.from(header);
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}
