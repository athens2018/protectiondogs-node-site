import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { issueSignedToken, presignUrl } from '@vercel/blob';
import { checkAdminAccess } from '../../../../lib/admin-auth';
import { IMAGE_TYPES, VIDEO_TYPES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from '../../../../lib/media-upload';

export const prerender = false;

/**
 * Issues a presigned PUT URL so the caller (the web admin form's own JS, or
 * the portal native app) can upload a gallery photo/video *directly* to
 * Vercel Blob — never through this or any other Vercel Function.
 *
 * Why this exists at all: a Vercel Function request body is capped at
 * 4.5 MB (hard platform limit, not a project setting) — found the hard way
 * when a real short training video 413'd. src/pages/admin/api/upload.ts's
 * multipart-through-the-function approach (still used for the Dogs CMS's
 * single hero photo) only ever worked because one hand-picked photo
 * usually happens to be small enough; it was never going to work for
 * video, and was never guaranteed for photos either. Gallery items skip
 * server-side WebP re-encoding as a result (sharp never sees these bytes) —
 * a deliberate trade of the auto-optimization nicety for uploads that
 * actually complete.
 */
function extForContentType(contentType: string): string {
  const table: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'video/mp4': 'mp4',
  };
  return table[contentType] ?? 'bin';
}

export const POST: APIRoute = async (context) => {
  try {
    return await handlePost(context);
  } catch (err) {
    // Last-resort net, matching items.ts's own — an unforeseen throw here
    // must still come back as JSON the caller's executeJson() can parse,
    // not Astro's default (HTML) error page.
    console.error('[admin/gallery/upload-url] unhandled error:', err instanceof Error ? err.stack ?? err.message : String(err));
    return new Response(
      JSON.stringify({ ok: false, error: `Unexpected server error: ${err instanceof Error ? err.message : String(err)}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

const handlePost: APIRoute = async ({ request, cookies }) => {
  const access = checkAdminAccess(cookies, request.headers.get('authorization'));
  if (!access.ok) return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const storeId = process.env.CMS_BLOB_READ_WRITE_TOKEN_STORE_ID;
  if (!storeId) {
    return new Response(
      JSON.stringify({ ok: false, error: 'The CMS storage isn\'t connected yet (CMS_BLOB_READ_WRITE_TOKEN_STORE_ID is not set).' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let body: { contentType?: string; sizeBytes?: number };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Malformed request.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const contentType = typeof body.contentType === 'string' ? body.contentType : '';
  const isImage = IMAGE_TYPES.has(contentType);
  const isVideo = VIDEO_TYPES.has(contentType);
  if (!isImage && !isVideo) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Unsupported file type. Use JPG, PNG, WebP or AVIF for photos, MP4 for video.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  const sizeBytes = typeof body.sizeBytes === 'number' ? body.sizeBytes : 0;
  if (sizeBytes > maxBytes) {
    return new Response(
      JSON.stringify({ ok: false, error: `File too large. Max ${isImage ? '10MB for photos' : '100MB for video'}.` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const pathname = `cms/media/${randomUUID()}.${extForContentType(contentType)}`;

  try {
    const signed = await issueSignedToken({
      storeId,
      pathname,
      operations: ['put'],
      allowedContentTypes: [contentType],
      maximumSizeInBytes: maxBytes,
      validUntil: Date.now() + 10 * 60 * 1000,
    });
    const { presignedUrl } = await presignUrl(signed, {
      operation: 'put',
      pathname,
      access: 'public',
      allowedContentTypes: [contentType],
      maximumSizeInBytes: maxBytes,
      addRandomSuffix: false,
      allowOverwrite: true,
      validUntil: Date.now() + 10 * 60 * 1000,
    });

    // The deterministic public URL for a public blob at a known pathname
    // with addRandomSuffix:false — same shape as what put() itself returns
    // elsewhere in this codebase (e.g. src/lib/media-upload.ts), so the
    // caller doesn't have to parse the PUT response to learn it.
    const url = `https://${storeId}.public.blob.vercel-storage.com/${pathname}`;

    return new Response(JSON.stringify({ ok: true, presignedUrl, url, pathname, contentType }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[admin/gallery/upload-url] failed:', message);
    // Surfaced verbatim (not a generic "please try again") so a failure
    // here is diagnosable from the app/admin page's own error text alone —
    // this is brand-new API surface (issueSignedToken/presignUrl) with no
    // production track record yet, unlike the rest of this codebase's
    // Blob calls.
    return new Response(JSON.stringify({ ok: false, error: `Could not prepare the upload: ${message}` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
