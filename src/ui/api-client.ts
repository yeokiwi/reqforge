// A small client for the pages API (08 section 3), shared by the page screens' client components
// (view, tree, history). The editor has its own, richer one in src/editor/ui/api.ts. Failures
// become the same typed ApiError (problem+json `code`, status and extras), so callers branch on
// `code` and show copy-deck strings; the server's `detail` is for logs only. The browser adds
// the `Origin` header that state-changing requests need (RD-064) and sends the session cookie.
// spec: docs/specs/08-api-surface.md sections 3 and 3.2 (RD-064, RD-072)
import { ApiError, problemToError } from "@/editor/ui/api";

export { ApiError };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const enc = encodeURIComponent;

/** URLs under `/api/v1/spaces/{key}`; every segment is percent-encoded. */
export const spaceUrls = (spaceKey: string) => {
  const base = `/api/v1/spaces/${enc(spaceKey)}`;
  const page = (id: string) => `${base}/pages/${enc(id)}`;
  return {
    pages: `${base}/pages`,
    page,
    move: (id: string) => `${page(id)}/move`,
    copy: (id: string) => `${page(id)}/copy`,
    watch: (id: string) => `${page(id)}/watch`,
    favourite: (id: string) => `${page(id)}/favourite`,
    attachments: (id: string) => `${page(id)}/attachments`,
    attachment: (id: string, attachmentId: string) => `${page(id)}/attachments/${enc(attachmentId)}`,
    versions: (id: string) => `${page(id)}/versions`,
    version: (id: string, n: number) => `${page(id)}/versions/${n}`,
    restore: (id: string, n: number) => `${page(id)}/versions/${n}/restore`,
  };
};

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (text === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * One API call. `body` is sent as JSON when given (a `FormData` is sent as multipart and gets no
 * `Content-Type`, so the browser adds the boundary). Resolves to the parsed JSON, or `null` for a
 * 204; rejects with an ApiError.
 */
export async function callApi(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json, application/problem+json" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetchImpl(url, { method, headers, body: payload, credentials: "same-origin" });
  } catch (error) {
    // fetch rejects when offline, on a reset connection, or when the caller aborts.
    const aborted = error instanceof DOMException && error.name === "AbortError";
    throw new ApiError(aborted ? "ABORTED" : "NETWORK", 0, [], null, null, error instanceof Error ? error.message : "");
  }
  const parsed = await readBody(response);
  if (!response.ok) throw problemToError(response.status, parsed);
  return parsed;
}
