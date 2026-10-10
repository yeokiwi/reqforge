// Success responses. Everything the pages API returns is per-user, so nothing is cacheable by
// a shared cache; JSON is not cached at all.

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** 204 for idempotent toggles, draft discard and deletes with nothing to report. */
export function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
