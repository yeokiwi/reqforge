// Test helpers for the page tree: PageSummary fixtures and a fetch whose answers the test hands
// out one by one, in any order — which is what the stale-response and rollback tests need.
import type { PageSummary } from "@/domain/documents";
import type { FetchLike } from "@/ui/api-client";

/** A page; ordinal defaults to 0 and the version fields are fixed. */
export function page(id: string, title: string, parentId: string | null = null, ordinal = 0): PageSummary {
  return { id, title, parentId, ordinal, currentVersion: 1, lastModifiedAt: "2026-10-01T00:00:00.000Z" };
}

/**
 * Specifications            (s)
 *   Page Heading            (h)
 *   Test session 1          (t1)
 *   Test session 1a         (t1a)
 *     Notes                 (n)
 * Team                      (team)
 *   Members                 (m)
 */
export function sampleTree(): PageSummary[] {
  return [
    page("s", "Specifications", null, 0),
    page("team", "Team", null, 1),
    page("h", "Page Heading", "s", 0),
    page("t1", "Test session 1", "s", 1),
    page("t1a", "Test session 1a", "s", 2),
    page("n", "Notes", "t1a", 0),
    page("m", "Members", "team", 0),
  ];
}

export interface PendingCall {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
  respond(status: number, body?: unknown): void;
  /** The network failed (fetch rejected). */
  fail(): void;
}

export interface FakeApi {
  readonly fetchImpl: FetchLike;
  /** Every request made, oldest first; answered ones stay in the list. */
  readonly calls: PendingCall[];
  /** Calls not yet answered. */
  pending(): PendingCall[];
}

export function problem(status: number, code: string): Record<string, unknown> {
  return { type: "about:blank", title: code, status, detail: code, code };
}

export function fakeApi(): FakeApi {
  const calls: PendingCall[] = [];
  const answered = new Set<PendingCall>();
  const fetchImpl: FetchLike = (url, init) =>
    new Promise<Response>((resolve, reject) => {
      const raw = init?.body;
      const call: PendingCall = {
        method: init?.method ?? "GET",
        url,
        body: typeof raw === "string" ? (JSON.parse(raw) as unknown) : undefined,
        respond(status, body) {
          answered.add(call);
          const contentType = status >= 400 ? "application/problem+json" : "application/json";
          resolve(new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": contentType } }));
        },
        fail() {
          answered.add(call);
          reject(new TypeError("Failed to fetch"));
        },
      };
      calls.push(call);
    });
  return { fetchImpl, calls, pending: () => calls.filter((c) => !answered.has(c)) };
}

/** Lets promise callbacks (fetch answers, `.then` chains) run. */
export async function settle(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
