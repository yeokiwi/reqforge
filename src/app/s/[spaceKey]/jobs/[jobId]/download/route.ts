import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { NextResponse } from 'next/server';
import { isAppError } from '@/domain/errors';
import { requireSpace } from '@/server/authz';
import { resolveStoredPath } from '@/server/jobs/storage';
import { findJob } from '@/server/repositories/jobs';

/**
 * Serves a finished export.
 * spec: 07-permissions-and-limits.md §2.1 — exports need EXPORT, re-checked here, so a
 * download URL is not a way around the permission that produced the file.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ spaceKey: string; jobId: string }> },
) {
  const { spaceKey, jobId } = await params;

  try {
    const { space } = await requireSpace(spaceKey, 'EXPORT');
    const job = await findJob(jobId);

    if (!job || job.spaceId !== space.id) {
      return NextResponse.json({ error: 'No such export.' }, { status: 404 });
    }
    if (job.state !== 'DONE' || !job.resultRef) {
      return NextResponse.json({ error: `That export is ${job.state.toLowerCase()}.` }, { status: 409 });
    }

    const path = resolveStoredPath(job.resultRef);
    if (!path) return NextResponse.json({ error: 'No such export.' }, { status: 404 });

    const file = await readFile(path);
    return new NextResponse(new Uint8Array(file), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${basename(path)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (isAppError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
