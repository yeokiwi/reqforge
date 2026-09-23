import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openApiDocument } from '@/server/api/openapi';
import { ROUTES } from '@/server/api/registry';

/**
 * The API surface is the spec's, exactly. spec: 08-api-surface.md §1 — the OpenAPI
 * document is "generated from the route handlers, not hand-written".
 */

const API_ROOT = join(process.cwd(), 'src/app/api/v1');

function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return entry === 'route.ts' ? [path] : [];
  });
}

/** `src/app/api/v1/spaces/[spaceKey]/requirements/route.ts` → `/spaces/{spaceKey}/requirements`. */
const openApiPathOf = (file: string) =>
  '/' + relative(API_ROOT, file).replace(/\/?route\.ts$/, '').replace(/\[(\w+)\]/g, '{$1}');

/** Every row of spec 08 §2–§6, read from the spec itself so the two cannot drift. */
function specRows(): Array<{ method: string; path: string }> {
  const text = readFileSync(join(process.cwd(), 'docs/specs/08-api-surface.md'), 'utf8');
  return [...text.matchAll(/^\| `(GET|POST|PUT|PATCH|DELETE)` \| `([^`?]+)(?:\?[^`]*)?`/gm)].map((match) => ({
    method: match[1]!,
    path: match[2]!.replace(/ — .*$/, '').trim(),
  }));
}

describe('the API surface', () => {
  it('has a route file for every registered path, and nothing else', () => {
    const files = routeFiles(API_ROOT).map(openApiPathOf).sort();
    const registered = [...new Set(ROUTES.map((route) => route.path))].sort();
    expect(files).toEqual(registered);
  });

  it('every route file takes its handlers from the registry', () => {
    for (const file of routeFiles(API_ROOT)) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).toContain(`routesAt('${openApiPathOf(file)}')`);
    }
  });

  it('implements every endpoint spec 08 §2–§6 lists, at its method and path', () => {
    const rows = specRows();
    expect(rows.length).toBeGreaterThanOrEqual(24);
    const registered = new Set(ROUTES.map((route) => `${route.method} ${route.path}`));
    const missing = rows.filter((row) => !registered.has(`${row.method} ${row.path}`));
    expect(missing).toEqual([]);
  });

  it('has one route per method and path', () => {
    const seen = ROUTES.map((route) => `${route.method} ${route.path}`);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe('the generated OpenAPI document', () => {
  const document = openApiDocument(ROUTES);

  it('is OpenAPI 3.1 with bearer auth', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
  });

  it('describes every registered operation, with unique operation ids', () => {
    const operations = Object.entries(document.paths).flatMap(([path, methods]) =>
      Object.entries(methods).map(([method, operation]) => ({ path, method, operation: operation as { operationId: string } })),
    );
    expect(operations).toHaveLength(ROUTES.length);
    const ids = operations.map((entry) => entry.operation.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('documents path parameters, query parameters and bodies from the zod schemas', () => {
    const list = document.paths['/spaces/{spaceKey}/requirements']?.get as {
      parameters: Array<{ name: string; in: string; required: boolean; schema: Record<string, unknown> }>;
    };
    const byName = new Map(list.parameters.map((parameter) => [parameter.name, parameter]));
    expect(byName.get('spaceKey')).toMatchObject({ in: 'path', required: true });
    expect(byName.get('limit')).toMatchObject({ in: 'query', required: false });
    expect(byName.get('limit')?.schema).toMatchObject({ maximum: 600, default: 50 });
    expect(byName.has('cursor')).toBe(true);
    expect(byName.has('offset')).toBe(false); // spec 08 §1 — never offset

    const put = document.paths['/spaces/{spaceKey}/documents/{id}']?.put as { requestBody: unknown };
    expect(JSON.stringify(put.requestBody)).toContain('"content"');
  });

  it('serves errors as RFC 9457 problem details', () => {
    const get = document.paths['/jobs/{id}']?.get as { responses: Record<string, { content?: Record<string, unknown> }> };
    expect(Object.keys(get.responses['404']?.content ?? {})).toEqual(['application/problem+json']);
  });

  it('is plain JSON', () => {
    expect(() => JSON.parse(JSON.stringify(document))).not.toThrow();
  });
});
