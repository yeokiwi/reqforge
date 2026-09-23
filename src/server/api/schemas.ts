import type { Job } from '@prisma/client';
import { z } from 'zod/v4';

/** Shapes shared by several routes. spec: 08-api-surface.md. */

export const spaceKey = z.string().regex(/^[A-Z][A-Z0-9]{1,15}$/, 'A space key is upper-case letters and digits.');
export const requirementKey = z.string().regex(/^[A-Za-z0-9._-]{2,64}$/, 'Not a requirement key.');

export const spaceParams = z.object({ spaceKey });

export const rqlDiagnostic = z.object({
  code: z.string(),
  message: z.string(),
  offset: z.number().int(),
  length: z.number().int(),
  hint: z.string().optional(),
  severity: z.enum(['error', 'warning']),
});

export const job = z.object({
  id: z.string(),
  kind: z.string(),
  state: z.enum(['QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED']),
  progress: z.number().int(),
  message: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  /** Where to poll (spec 08 §6). */
  href: z.string(),
  /** Present once an export job is DONE. */
  resultHref: z.string().nullable(),
});

/** spec 08 §6 — "Every long operation in this API returns `202` with a job reference." */
export const accepted = z.object({ job });

export function jobView(row: Job): z.output<typeof job> {
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    progress: row.progress,
    message: row.message,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    href: `/api/v1/jobs/${row.id}`,
    resultHref: row.state === 'DONE' && row.resultRef ? `/api/v1/jobs/${row.id}/result` : null,
  };
}

export const problemSchema = z.looseObject({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  code: z.string(),
});

export const requirement = z.object({
  recordId: z.string(),
  key: z.string(),
  space: z.string(),
  baseline: z.number().int().nullable(),
  title: z.string(),
  status: z.string(),
  bodyHtml: z.string(),
  properties: z.array(z.object({ name: z.string(), value: z.string(), external: z.boolean() })).optional(),
  dependencies: z
    .array(
      z.object({
        direction: z.enum(['to', 'from']),
        relationship: z.string(),
        key: z.string(),
        space: z.string(),
        restricted: z.boolean(),
        title: z.string().nullable(),
      }),
    )
    .optional(),
  links: z
    .array(z.object({ documentId: z.string(), documentTitle: z.string(), version: z.number().int(), origin: z.boolean() }))
    .optional(),
  validation: z.array(z.object({ type: z.string().nullable(), status: z.string(), messages: z.unknown() })).optional(),
});

/** `?expand=properties,dependencies` or repeated `?expand=`. */
export const expandSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((raw, context) => {
    const names = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((part) => part.split(',')).map((part) => part.trim()).filter(Boolean);
    const allowed = ['properties', 'dependencies', 'links', 'validation'] as const;
    const unknown = names.filter((name) => !(allowed as readonly string[]).includes(name));
    if (unknown.length > 0) {
      context.addIssue({ code: 'custom', message: `Unknown expansion: ${unknown.join(', ')}. Use ${allowed.join(', ')}.` });
      return z.NEVER;
    }
    return new Set(names as Array<(typeof allowed)[number]>);
  });
