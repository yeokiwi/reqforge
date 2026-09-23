import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { NextResponse } from 'next/server';
import { isAppError } from '@/domain/errors';
import { resolveStoredPath } from '@/server/jobs/storage';
import { downloadExportUseCase } from '@/server/usecases/jobs';

/**
 * Serves a finished export.
 * spec: 07-permissions-and-limits.md §2.1 — exports need EXPORT, re-checked here, so a
 * download URL is not a way around the permission that produced the file; and only the
 * person who queued the export may fetch it, because it holds what *they* could see.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ spaceKey: string; jobId: string }> },
) {
  const { spaceKey, jobId } = await params;

  try {
    // EXPORT, the person who queued it, DONE, and an audit row: all in the use case.
    const { resultRef } = await downloadExportUseCase(spaceKey, jobId);
    const path = resolveStoredPath(resultRef);
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
