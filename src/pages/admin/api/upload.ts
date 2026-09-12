import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { put } from '@vercel/blob';
import { checkAdminAccess } from '../../../lib/admin-auth';

export const prerender = false;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const VIDEO_TYPES = new Set(['video/mp4']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120);
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const access = checkAdminAccess(cookies);
  if (!access.ok) return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401 });

  const token = process.env.CMS_BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return new Response(
      JSON.stringify({ ok: false, error: 'The CMS storage isn\'t connected yet (CMS_BLOB_READ_WRITE_TOKEN is not set).' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Malformed upload.' }), { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return new Response(JSON.stringify({ ok: false, error: 'No file provided.' }), { status: 400 });
  }

  const isImage = IMAGE_TYPES.has(file.type);
  const isVideo = VIDEO_TYPES.has(file.type);
  if (!isImage && !isVideo) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Unsupported file type. Use JPG, PNG, WebP or AVIF for photos, MP4 for video.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (file.size > maxBytes) {
    return new Response(
      JSON.stringify({ ok: false, error: `File too large. Max ${isImage ? '10MB for photos' : '100MB for video'}.` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const pathname = `cms/media/${randomUUID()}-${sanitizeFilename(file.name || 'upload')}`;
  try {
    const blob = await put(pathname, file, {
      access: 'public',
      token,
      contentType: file.type,
      addRandomSuffix: false,
    });
    return new Response(JSON.stringify({ ok: true, url: blob.url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[admin/upload] blob put failed:', err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ ok: false, error: 'Upload failed. Please try again.' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
