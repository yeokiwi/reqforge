import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { z } from 'zod/v4';
import { NotFoundError } from '@/domain/errors';
import { resolveStoredPath } from '@/server/jobs/storage';
import { assertExportReadyUseCase, cancelJobUseCase, downloadExportUseCase, myJobUseCase } from '@/server/usecases/jobs';
import { defineRoute } from '../define-route';
import { job, jobView } from '../schemas';

/**
 * spec: 08-api-surface.md §6 — jobs. A job is addressed by id alone and belongs to the
 * person who queued it; anyone else gets 404 (`myJobUseCase`).
 */

const TAG = 'Jobs';
const jobParams = z.object({ id: z.string().min(1).max(64) });

export const getJob = defineRoute({
  method: 'GET',
  path: '/jobs/{id}',
  tag: TAG,
  summary: 'State, progress, message and result reference of a job',
  params: jobParams,
  response: job,
  handler: async ({ params }) => jobView((await myJobUseCase(params.id)).job),
});

export const cancelJob = defineRoute({
  method: 'POST',
  path: '/jobs/{id}/cancel',
  tag: TAG,
  summary: 'Ask a queued or running job to stop',
  status: 202,
  params: jobParams,
  response: job,
  handler: async ({ params }) => {
    const { spaceKey } = await myJobUseCase(params.id);
    await cancelJobUseCase(spaceKey, params.id);
    return jobView((await myJobUseCase(params.id)).job);
  },
});

export const jobResult = defineRoute({
  method: 'GET',
  path: '/jobs/{id}/result',
  tag: TAG,
  summary: 'Redirects (302) to the artefact of a finished export',
  status: 302,
  params: jobParams,
  response: z.null(),
  handler: async ({ params, request }) => {
    // EXPORT, ownership and DONE; the artefact itself audits the download (RD-062).
    await assertExportReadyUseCase(params.id);
    // Same origin, so a client following the redirect keeps its bearer header.
    return Response.redirect(new URL(`/api/v1/jobs/${params.id}/artifact`, request.url), 302);
  },
});

export const jobArtifact = defineRoute({
  method: 'GET',
  path: '/jobs/{id}/artifact',
  tag: TAG,
  summary: 'The artefact file of a finished export (xlsx)',
  params: jobParams,
  response: z.unknown(),
  handler: async ({ params }) => {
    const { job: row, spaceKey } = await myJobUseCase(params.id);
    if (row.state !== 'DONE' || !row.resultRef) throw new NotFoundError('That job has no artefact.');
    // Checks EXPORT, ownership and DONE again, and writes the download's audit row.
    const { resultRef } = await downloadExportUseCase(spaceKey, params.id);
    const path = resolveStoredPath(resultRef);
    if (!path) throw new NotFoundError('That artefact no longer exists.');
    const file = await readFile(path).catch(() => {
      throw new NotFoundError('That artefact no longer exists.');
    });
    return new Response(new Uint8Array(file), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${basename(path)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  },
});

export const jobRoutes = [getJob, cancelJob, jobResult, jobArtifact];
