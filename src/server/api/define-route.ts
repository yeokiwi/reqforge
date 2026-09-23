import { z } from 'zod/v4';
import { isApiScope } from '@/domain/api-scopes';
import { AuthenticationError, ForbiddenError, isAppError, QueryError, type Problem } from '@/domain/errors';
import type { RqlDiagnostic } from '@/domain/ryql';
import { runWithPrincipal, type Principal } from '@/server/auth/principal';
import { userFromCookieHeader } from '@/server/auth/session';
import { authenticateToken } from '@/server/repositories/api-tokens';

/**
 * The one way an `/api/v1` endpoint is written. spec: 08-api-surface.md §1.
 *
 * A route is a value: method, path, schemas and handler together. The same zod schemas
 * validate every request and generate the OpenAPI document (`openapi.ts`), so the document
 * describes exactly what the handler accepts — it cannot drift, because there is nothing
 * else to drift from ("generated from the route handlers, not hand-written").
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type Schema = z.ZodType;
type Out<S> = S extends z.ZodType ? z.output<S> : undefined;

export type RouteInput<P, Q, B> = {
  params: Out<P>;
  query: Out<Q>;
  body: Out<B>;
  request: Request;
  /** Null only on a route declared `authenticated: false` (the OpenAPI document). */
  principal: Principal | null;
};

export type RouteDefinition<P = undefined, Q = undefined, B = undefined, R extends Schema = Schema> = {
  method: HttpMethod;
  /** OpenAPI form, relative to `/api/v1`: `/spaces/{spaceKey}/requirements`. */
  path: string;
  summary: string;
  tag: string;
  params?: P;
  query?: Q;
  body?: B;
  /** The success body. Documented, and checked against in tests (see `respond`). */
  response: R;
  /** Default 200; 202 for anything that returns a job (spec 08 §6). */
  status?: 200 | 201 | 202 | 204 | 302;
  /** `false` only for the OpenAPI document itself. */
  authenticated?: boolean;
  handler: (input: RouteInput<P, Q, B>) => Promise<z.output<R> | Response>;
};

export type AnyRoute = RouteDefinition<Schema | undefined, Schema | undefined, Schema | undefined, Schema>;

export function problem(status: number, body: Omit<Problem, 'status'>): Response {
  return new Response(JSON.stringify({ ...body, status }), {
    status,
    headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store' },
  });
}

/** An RQL failure as a problem, with the spec 02 §9 diagnostics embedded (spec 08 §1). */
export function queryProblem(errors: readonly RqlDiagnostic[]): never {
  throw new QueryError(errors[0]?.message ?? 'That query is not valid.', { errors: [...errors] });
}

/**
 * RD-069 — a cookie-authenticated write must come from the app's own origin. A browser
 * attaches the session cookie to a cross-site form post by itself; it never attaches an
 * `Authorization` header by itself, so bearer requests need no such check.
 */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const own = new URL(request.url).origin;
  const configured = process.env.REQFORGE_BASE_URL ? new URL(process.env.REQFORGE_BASE_URL).origin : null;
  return origin === own || origin === configured;
}

async function authenticate(request: Request): Promise<Principal> {
  const header = request.headers.get('authorization');
  if (header !== null) {
    // A bearer header that does not authenticate is a 401, never a fallback to the cookie:
    // a CI job with a revoked token must fail loudly, not act as whoever is signed in.
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    const token = match ? await authenticateToken(match[1]!) : null;
    if (!token) throw new AuthenticationError('That API token is not valid, or has been revoked.');
    return {
      kind: 'token',
      user: token.user,
      tokenId: token.tokenId,
      scopes: token.scopes.filter(isApiScope),
      spaceKeys: token.spaceKeys,
    };
  }

  const user = await userFromCookieHeader(request.headers.get('cookie'));
  if (!user) throw new AuthenticationError('Send an API token as `Authorization: Bearer rf_…`, or sign in.');
  if (request.method !== 'GET' && request.method !== 'HEAD' && !sameOrigin(request)) {
    throw new ForbiddenError('A request made with a session cookie must come from this site (RD-069).');
  }
  return { kind: 'session', user };
}

function issues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

function badRequest(where: string, error: z.ZodError): Response {
  return problem(400, {
    type: 'https://reqforge.dev/problems/bad-request',
    title: 'Bad request',
    detail: `The ${where} does not match what this endpoint accepts.`,
    code: 'BAD_REQUEST',
    issues: issues(error),
  });
}

function toResponse(status: number, value: unknown): Response {
  if (value instanceof Response) return value;
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Query parameters as an object; a repeated name becomes an array. */
function queryObject(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of url.searchParams) {
    const previous = out[name];
    out[name] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  }
  return out;
}

/**
 * The Next handler for one route. Order matters: authenticate first, so an anonymous
 * caller learns nothing from validation messages; then validate; then run the use case
 * inside the principal, so `requireSpace` sees the token's scopes.
 */
export function handlerOf(route: AnyRoute) {
  return async (request: Request, context: { params: Promise<Record<string, string>> }): Promise<Response> => {
    try {
      const principal: Principal | null = route.authenticated === false ? null : await authenticate(request);

      const rawParams = await context.params;
      const params = route.params ? route.params.safeParse(rawParams) : { success: true as const, data: undefined };
      if (!params.success) return badRequest('path', params.error);

      const query = route.query ? route.query.safeParse(queryObject(new URL(request.url))) : { success: true as const, data: undefined };
      if (!query.success) return badRequest('query string', query.error);

      let body: { success: true; data: unknown } | { success: false; error: z.ZodError } = { success: true, data: undefined };
      if (route.body) {
        let json: unknown;
        try {
          json = await request.json();
        } catch {
          return problem(400, {
            type: 'https://reqforge.dev/problems/bad-request',
            title: 'Bad request',
            detail: 'The request body is not JSON.',
            code: 'BAD_REQUEST',
          });
        }
        body = route.body.safeParse(json);
        if (!body.success) return badRequest('body', body.error);
      }

      const run = () =>
        route.handler({ params: params.data, query: query.data, body: body.success ? body.data : undefined, request, principal });
      const value = principal === null ? await run() : await runWithPrincipal(principal, run);
      return toResponse(route.status ?? 200, checked(route, value));
    } catch (error) {
      if (isAppError(error)) return problem(error.status, error.toProblem());
      // Unexpected: logged for the operator, never described to the caller.
      console.error(`[api] ${route.method} ${route.path}`, error);
      return problem(500, {
        type: 'https://reqforge.dev/problems/internal',
        title: 'Internal error',
        detail: 'Something went wrong on our side.',
        code: 'INTERNAL',
      });
    }
  };
}

/**
 * In tests every response is parsed against the route's documented schema, so a handler
 * that returns something its OpenAPI entry does not describe fails the suite instead of
 * shipping a document that lies. Production skips the cost.
 */
function checked(route: AnyRoute, value: unknown): unknown {
  if (value instanceof Response || process.env.NODE_ENV !== 'test') return value;
  const result = route.response.safeParse(value);
  if (!result.success) {
    throw new Error(
      `${route.method} ${route.path} returned a body its schema does not describe: ${JSON.stringify(issues(result.error))}`,
    );
  }
  return value;
}

export function defineRoute<P extends Schema | undefined, Q extends Schema | undefined, B extends Schema | undefined, R extends Schema>(
  route: RouteDefinition<P, Q, B, R>,
): AnyRoute {
  return route as unknown as AnyRoute;
}

/** `export const { GET, POST } = handlers(routes)` in a `route.ts`. */
export function handlers(routes: readonly AnyRoute[]): Partial<Record<HttpMethod, ReturnType<typeof handlerOf>>> {
  const out: Partial<Record<HttpMethod, ReturnType<typeof handlerOf>>> = {};
  for (const route of routes) out[route.method] = handlerOf(route);
  return out;
}
