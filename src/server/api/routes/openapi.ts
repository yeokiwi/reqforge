import { z } from 'zod/v4';
import { defineRoute } from '../define-route';

/**
 * spec 08 §1 — "OpenAPI 3.1 document served at `/api/v1/openapi.json`". Public: it
 * describes shapes, not data. Imported lazily to avoid a cycle with the registry.
 */
export const openApiRoute = defineRoute({
  method: 'GET',
  path: '/openapi.json',
  tag: 'Meta',
  summary: 'This document',
  authenticated: false,
  response: z.looseObject({ openapi: z.literal('3.1.0') }),
  handler: async () => {
    const [{ openApiDocument }, { ROUTES }] = await Promise.all([import('../openapi'), import('../registry')]);
    return openApiDocument(ROUTES);
  },
});

export const openApiRoutes = [openApiRoute];
