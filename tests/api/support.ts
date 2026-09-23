import { routesAt } from '@/server/api/registry';

/**
 * Calls an `/api/v1` handler the way Next does: a real `Request`, and the path params as a
 * promise. Nothing is mocked — authentication, validation and the use cases all run.
 */
export async function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  params: Record<string, string>,
  options: { token?: string; body?: unknown; query?: Record<string, string>; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const handler = routesAt(path)[method];
  if (!handler) throw new Error(`No ${method} handler at ${path}`);
  const concrete = path.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(params[name] ?? ''));
  const url = new URL(`http://reqforge.test/api/v1${concrete}`);
  for (const [name, value] of Object.entries(options.query ?? {})) url.searchParams.set(name, value);

  const response = await handler(
    new Request(url, {
      method,
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    }),
    { params: Promise.resolve(params) },
  );
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    // binary or empty
  }
  return { status: response.status, body, headers: response.headers };
}
