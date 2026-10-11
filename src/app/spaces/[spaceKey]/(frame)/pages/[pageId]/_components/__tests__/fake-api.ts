// A scripted stand-in for the pages API, for the `···` dialogs' component tests: it records every
// request (method, URL, body) and answers from a handler, which may hold an answer back (to test
// what happens while a request is in flight).
import type { FetchLike } from "@/ui/api-client";

export interface SentRequest {
  readonly method: string;
  readonly url: string;
  readonly body: BodyInit | null | undefined;
}

export type Responder = (request: SentRequest) => Response | Promise<Response>;

export function fakeApi(respond: Responder) {
  const sent: SentRequest[] = [];
  const state = { respond };
  const fetchImpl: FetchLike = (url, init) => {
    const request = { method: init?.method ?? "GET", url, body: init?.body };
    sent.push(request);
    return Promise.resolve(state.respond(request));
  };
  return {
    sent,
    fetchImpl,
    /** Swap the handler mid-test. */
    answer(next: Responder) {
      state.respond = next;
    },
    /** The requests that changed something (everything but GET). */
    writes: () => sent.filter((r) => r.method !== "GET"),
  };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const noContent = () => new Response(null, { status: 204 });

export const problem = (status: number, code: string, extras: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ type: "about:blank", title: code, status, detail: "", code, ...extras }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });

/** A response the test releases when it chooses. */
export function deferred() {
  let release: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { promise, release: (response: Response) => release(response) };
}

/** The parsed JSON body of a recorded request. */
export function bodyOf(request: SentRequest | undefined): unknown {
  if (request === undefined || typeof request.body !== "string") return undefined;
  return JSON.parse(request.body) as unknown;
}
