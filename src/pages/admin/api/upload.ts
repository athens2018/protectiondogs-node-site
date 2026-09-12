import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { put } from '@vercel/blob';
import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';
import { checkAdminAccess } from '../../../lib/admin-auth';

export const prerender = false;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const VIDEO_TYPES = new Set(['video/mp4']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB
/** Owner-uploaded photos (often straight off a phone) get downsized to this before storing — plenty for anything on the site, which never renders a dog photo larger than this. */
const MAX_IMAGE_WIDTH = 1600;

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120);
}

/**
 * Re-encodes an uploaded photo as WebP (resized down if it's wider than
 * MAX_IMAGE_WIDTH) so owner-uploaded photos load as fast as the site's own
 * hand-optimized images, without the owner needing to know what a "web
 * format" is. Falls back to storing the original bytes untouched if sharp
 * fails for any reason — a failed optimization must never block an upload.
 */
async function optimizeImage(file: File): Promise<{ buffer: Buffer; contentType: string }> {
  const original = Buffer.from(await file.arrayBuffer());
  try {
    const buffer = await sharp(original)
      .rotate() // bake in EXIF orientation before it's stripped
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    return { buffer, contentType: 'image/webp' };
  } catch (err) {
    console.error('[admin/upload] image optimization failed; storing the original file unmodified:', err instanceof Error ? err.message : String(err));
    return { buffer: original, contentType: file.type };
  }
}

const VISION_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * Asks Claude to describe the just-uploaded main photo, so the owner doesn't
 * have to write alt text by hand — src/scripts/admin-dog-form.ts fills the
 * "Photo alt text" field with this only when it's still empty (never
 * overwriting something the owner already typed). Only called for the main
 * dog photo (see the `target === 'photo.src'` check below), not every image
 * upload, since it's the only upload with a dedicated alt-text field. Fails
 * soft (returns null) on any error, missing key, or unsupported format
 * (e.g. the rare case where optimizeImage's own fallback path keeps an
 * original AVIF file — vision input only accepts jpeg/png/webp/gif).
 */
async function generateAltText(imageBuffer: Buffer, contentType: string): Promise<string | null> {
  if (!VISION_MEDIA_TYPES.has(contentType)) return null;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 200,
      output_config: { effort: 'low' },
      system:
        'You write concise, accurate alt text for photos on a working-dog breeding website (Protection Dogs GR). ' +
        'Describe only what is actually visible — the dog\'s appearance, pose, and setting — in one short, plain ' +
        'sentence, the way a good accessibility alt attribute reads. No marketing language, no "image of" or ' +
        '"photo of", and don\'t guess the dog\'s name (a photo alone doesn\'t tell you that). Reply with ONLY the ' +
        'alt text and nothing else.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: contentType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: imageBuffer.toString('base64') } },
            { type: 'text', text: 'Write the alt text for this photo.' },
          ],
        },
      ],
    });
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    const text = textBlock?.text.trim();
    return text || null;
  } catch (err) {
    console.error('[admin/upload] alt-text generation failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const access = checkAdminAccess(cookies);
  if (!access.ok) return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401 });

  // See src/lib/cms.ts's top-of-file comment: this store's connection uses
  // Vercel's OIDC-based Blob auth (ambient VERCEL_OIDC_TOKEN + an explicit
  // storeId), not a classic bearer token — nothing here reads a token.
  const storeId = process.env.CMS_BLOB_READ_WRITE_TOKEN_STORE_ID;
  if (!storeId) {
    return new Response(
      JSON.stringify({ ok: false, error: 'The CMS storage isn\'t connected yet (CMS_BLOB_READ_WRITE_TOKEN_STORE_ID is not set).' }),
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

  const target = String(form.get('target') ?? '');

  let body: Buffer | File = file;
  let contentType = file.type;
  let pathname = `cms/media/${randomUUID()}-${sanitizeFilename(file.name || 'upload')}`;
  let altText: string | null = null;

  if (isImage) {
    const optimized = await optimizeImage(file);
    body = optimized.buffer;
    contentType = optimized.contentType;
    pathname = `cms/media/${randomUUID()}.${contentType === 'image/webp' ? 'webp' : sanitizeFilename(file.name || 'upload').split('.').pop() || 'bin'}`;
    if (target === 'photo.src') {
      altText = await generateAltText(optimized.buffer, contentType);
    }
  }

  try {
    const blob = await put(pathname, body, {
      access: 'public',
      storeId,
      contentType,
      addRandomSuffix: false,
    });
    return new Response(JSON.stringify({ ok: true, url: blob.url, altText }), {
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
