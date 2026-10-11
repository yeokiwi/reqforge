// Shared helpers for the pages use-case tests.
import { expect } from "vitest";
import type { AppError } from "@/domain/errors";
import { validateDocumentJson } from "@/editor/schema";
import type { Actor } from "@/server/authz/actor";
import { uploadAttachment } from "@/server/usecases/pages";
import { actorFor, prisma, type Handle } from "@/test-support/fixtures";

export const TEAM = "TEAM";
export const PLAT = "PLAT";

/** The settled rejection of a promise that must reject. */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected the promise to reject");
    },
    (e: unknown) => e,
  );
}

/** Asserts that `promise` rejects with an AppError of class `type` and returns it. */
export async function expectError<E extends AppError>(promise: Promise<unknown>, type: new (...args: never[]) => E): Promise<E> {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(type);
  return error as E;
}

export interface Actors {
  readonly alice: Actor;
  readonly bob: Actor;
  readonly carol: Actor;
}

export async function actors(): Promise<Actors> {
  const all = await Promise.all((["alice", "bob", "carol"] as Handle[]).map((h) => actorFor(h)));
  return { alice: all[0] as Actor, bob: all[1] as Actor, carol: all[2] as Actor };
}

/** The bytes of a minimal PNG: the signature is what makes it an image (RD-071). */
export function pngBytes(extra = 32): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const out = new Uint8Array(sig.length + extra);
  out.set(sig, 0);
  for (let i = 0; i < extra; i++) out[sig.length + i] = (i * 7 + extra) & 0xff;
  return out;
}

/** A paragraph holding one image node per attachment, plus a text paragraph. */
export function imageDoc(...images: { readonly id: string; readonly url: string }[]): unknown {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Diagram below" }] },
      {
        type: "paragraph",
        content: images.map((img) => ({ type: "image", attrs: { attachmentId: img.id, src: img.url, alt: "A diagram", title: null, width: null } })),
      },
    ],
  };
}

/** Uploads a PNG to a page through the use case. */
export async function uploadPng(actor: Actor, spaceKey: string, pageId: string, filename = "diagram.png") {
  return uploadAttachment(actor, spaceKey, pageId, { filename, declaredContentType: "image/png", bytes: pngBytes() });
}

/** The canonical form the server stores for `doc` (RD-063); throws if `doc` is invalid. */
export function canonical(doc: unknown): unknown {
  const result = validateDocumentJson(doc);
  if (!result.ok) throw new Error(`not a valid document: ${JSON.stringify(result.errors)}`);
  return result.doc;
}

/** Audit rows, oldest first, optionally for one object. */
export async function auditRows(objectId?: string) {
  return prisma.auditEvent.findMany({
    where: objectId === undefined ? {} : { objectId },
    orderBy: [{ at: "asc" }, { id: "asc" }],
  });
}

/**
 * Resolves once another session of this test database is blocked waiting for a lock — how a
 * test knows that a use case it started has reached the lock the test is holding, so it can
 * change the data under it deterministically, with no sleeps.
 */
export async function untilSomeoneWaitsForALock(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [row] = await prisma.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS "waiting" FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
    if ((row?.waiting ?? 0) > 0) return;
    if (Date.now() > deadline) throw new Error("no session started waiting for a lock");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Version numbers of a page, oldest first. */
export async function versionNumbers(documentId: string): Promise<number[]> {
  const rows = await prisma.documentVersion.findMany({ where: { documentId }, orderBy: { number: "asc" }, select: { number: true } });
  return rows.map((r) => r.number);
}
