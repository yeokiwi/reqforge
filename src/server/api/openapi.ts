import { z } from 'zod/v4';
import type { AnyRoute } from './define-route';
import { problemSchema } from './schemas';

/**
 * OpenAPI 3.1, generated from the registered routes. spec: 08-api-surface.md §1 —
 * "generated from the route handlers, not hand-written". OpenAPI 3.1 uses JSON Schema
 * 2020-12, which is what zod emits, so each schema is used as produced.
 */

type JsonSchema = Record<string, unknown>;

function schemaOf(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  const produced = z.toJSONSchema(schema, { io, unrepresentable: 'any', target: 'draft-2020-12' }) as JsonSchema;
  const { $schema: _dialect, ...rest } = produced;
  return rest;
}

function parametersOf(schema: z.ZodType | undefined, where: 'path' | 'query') {
  if (!schema) return [];
  const json = schemaOf(schema, 'input');
  const properties = (json.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((json.required as string[] | undefined) ?? []);
  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: where,
    required: where === 'path' ? true : required.has(name),
    schema: property,
  }));
}

function operationId(route: AnyRoute): string {
  const words = route.path
    .split('/')
    .filter(Boolean)
    .map((part) => part.replace(/[{}]/g, ''))
    .map((part) => part.replace(/[^A-Za-z0-9]+(.)/g, (_, next: string) => next.toUpperCase()));
  return [route.method.toLowerCase(), ...words.map((word) => word.charAt(0).toUpperCase() + word.slice(1))].join('');
}

const PROBLEM = { $ref: '#/components/schemas/Problem' };

export function openApiDocument(routes: readonly AnyRoute[]) {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    const status = String(route.status ?? 200);
    const success =
      status === '204'
        ? { description: 'No content' }
        : status === '302'
          ? { description: 'Redirect to the artefact', headers: { Location: { schema: { type: 'string' } } } }
          : {
              description: 'Success',
              content: { 'application/json': { schema: schemaOf(route.response, 'output') } },
            };

    const operation: Record<string, unknown> = {
      operationId: operationId(route),
      summary: route.summary,
      tags: [route.tag],
      parameters: [...parametersOf(route.params, 'path'), ...parametersOf(route.query, 'query')],
      responses: {
        [status]: success,
        '400': { description: 'Bad request, or an invalid RQL query', content: { 'application/problem+json': { schema: PROBLEM } } },
        ...(route.authenticated === false
          ? {}
          : {
              '401': { description: 'Not authenticated', content: { 'application/problem+json': { schema: PROBLEM } } },
              '403': { description: 'Forbidden', content: { 'application/problem+json': { schema: PROBLEM } } },
              '404': { description: 'Not found, or not visible to the caller', content: { 'application/problem+json': { schema: PROBLEM } } },
            }),
      },
      ...(route.authenticated === false ? { security: [] } : {}),
    };
    if (route.body) {
      operation.requestBody = { required: true, content: { 'application/json': { schema: schemaOf(route.body, 'input') } } };
    }

    paths[route.path] = { ...(paths[route.path] ?? {}), [route.method.toLowerCase()]: operation };
  }

  return {
    openapi: '3.1.0' as const,
    info: {
      title: 'Reqforge API',
      version: '1',
      description:
        'Every endpoint enforces the same permission and visibility rules as the application (spec 07); there is no privileged API path. Authenticate with `Authorization: Bearer rf_…`.',
    },
    servers: [{ url: '/api/v1' }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'An API token, `rf_<id>_<secret>` (spec 08 §1).' } },
      schemas: { Problem: schemaOf(problemSchema, 'output') },
    },
    paths,
  };
}
