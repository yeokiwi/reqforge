import type { AnyRoute, HttpMethod } from './define-route';
import { handlerOf } from './define-route';
import { analysisRoutes } from './routes/analysis';
import { baselineRoutes } from './routes/baselines';
import { documentRoutes } from './routes/documents';
import { jobRoutes } from './routes/jobs';
import { openApiRoutes } from './routes/openapi';
import { requirementRoutes } from './routes/requirements';
import { webhookRoutes } from './routes/webhooks';

/**
 * Every `/api/v1` route, in one list. The OpenAPI document is generated from this list,
 * and every `route.ts` under `src/app/api/v1` takes its handlers from it by path — so a
 * route cannot exist without being documented, nor be documented without existing
 * (`tests/api/openapi.test.ts` checks both directions).
 */
export const ROUTES: readonly AnyRoute[] = [
  ...requirementRoutes,
  ...documentRoutes,
  ...baselineRoutes,
  ...analysisRoutes,
  ...jobRoutes,
  ...webhookRoutes,
  ...openApiRoutes,
];

/** The Next handlers for one path: `export const { GET, POST } = routesAt('/…')`. */
export function routesAt(path: string): Partial<Record<HttpMethod, ReturnType<typeof handlerOf>>> {
  const matching = ROUTES.filter((route) => route.path === path);
  if (matching.length === 0) throw new Error(`No API route is registered at ${path}.`);
  const out: Partial<Record<HttpMethod, ReturnType<typeof handlerOf>>> = {};
  for (const route of matching) out[route.method] = handlerOf(route);
  return out;
}
