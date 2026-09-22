import { NextResponse } from 'next/server';
import { isAppError } from '@/domain/errors';
import { requireSpace } from '@/server/authz';
import { readStoredImage } from '@/server/images/store';

/**
 * Serves a materialised baseline image.
 * spec: 05-baselines-and-diff.md §3.2 step 7; 07 rule X3 — a frozen body's image is
 * requirement content, so it is read behind a permission check like everything else,
 * never by bare path. The digest is unguessable but that is not the control.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ spaceKey: string; name: string }> },
): Promise<Response> {
  const { spaceKey, name } = await params;

  try {
    await requireSpace(spaceKey);
  } catch (error) {
    if (isAppError(error)) return new NextResponse(error.message, { status: error.status });
    throw error;
  }

  const image = await readStoredImage(decodeURIComponent(name));
  if (!image) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(new Uint8Array(image.bytes), {
    headers: {
      'Content-Type': image.mediaType,
      // The bytes behind a digest can never change, which is the point of storing them
      // this way — so the cache may hold them for ever.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
