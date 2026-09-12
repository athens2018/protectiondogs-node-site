// Shared photo/video upload handling for every admin upload surface (the
// Dogs CMS form's photo/video fields, src/pages/admin/api/upload.ts; the
// gallery's item uploads, src/pages/admin/api/gallery/items.ts). Pulled out
// so both share the same size limits, WebP re-encoding, and filename
// handling instead of drifting apart.
import { randomUUID } from 'node:crypto';
import { put } from '@vercel/blob';
import sharp from 'sharp';

export const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
export const VIDEO_TYPES = new Set(['video/mp4']);
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB
/** Owner-uploaded photos (often straight off a phone) get downsized to this before storing — plenty for anything on the site, which never renders a photo larger than this. */
const MAX_IMAGE_WIDTH = 1600;

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120);
}

/**
 * Re-encodes an uploaded photo as WebP (resized down if it's wider than
 * MAX_IMAGE_WIDTH) so owner-uploaded photos load as fast as the site's own
 * hand-optimized images, without the owner needing to know what a "web
 * format" is. Falls back to storing the original bytes untouched if sharp
 * fails for any reason — a failed optimization must never block an upload.
 */
export async function optimizeImage(file: File): Promise<{ buffer: Buffer; contentType: string }> {
  const original = Buffer.from(await file.arrayBuffer());
  try {
    const buffer = await sharp(original)
      .rotate() // bake in EXIF orientation before it's stripped
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    return { buffer, contentType: 'image/webp' };
  } catch (err) {
    console.error('[media-upload] image optimization failed; storing the original file unmodified:', err instanceof Error ? err.message : String(err));
    return { buffer: original, contentType: file.type };
  }
}

export interface UploadResult {
  ok: true;
  url: string;
  contentType: string;
  body: Buffer | File;
}
export interface UploadError {
  ok: false;
  status: number;
  error: string;
}

/**
 * Validates, optimizes (images only), and stores one uploaded file under
 * `cms/media/` in the CMS's public Blob store. Shared validation + storage
 * path for every upload surface — callers handle anything specific to
 * their own form (e.g. upload.ts's alt-text generation) around this.
 */
export async function storeUploadedMedia(file: File, storeId: string): Promise<UploadResult | UploadError> {
  const isImage = IMAGE_TYPES.has(file.type);
  const isVideo = VIDEO_TYPES.has(file.type);
  if (!isImage && !isVideo) {
    return { ok: false, status: 400, error: 'Unsupported file type. Use JPG, PNG, WebP or AVIF for photos, MP4 for video.' };
  }
  const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (file.size > maxBytes) {
    return { ok: false, status: 400, error: `File too large. Max ${isImage ? '10MB for photos' : '100MB for video'}.` };
  }

  let body: Buffer | File = file;
  let contentType = file.type;
  let pathname = `cms/media/${randomUUID()}-${sanitizeFilename(file.name || 'upload')}`;

  if (isImage) {
    const optimized = await optimizeImage(file);
    body = optimized.buffer;
    contentType = optimized.contentType;
    pathname = `cms/media/${randomUUID()}.${contentType === 'image/webp' ? 'webp' : sanitizeFilename(file.name || 'upload').split('.').pop() || 'bin'}`;
  }

  try {
    const blob = await put(pathname, body, { access: 'public', storeId, contentType, addRandomSuffix: false });
    return { ok: true, url: blob.url, contentType, body };
  } catch (err) {
    console.error('[media-upload] blob put failed:', err instanceof Error ? err.message : String(err));
    return { ok: false, status: 502, error: 'Upload failed. Please try again.' };
  }
}
