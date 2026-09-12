import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { checkAdminAccess } from '../../../lib/admin-auth';
import { storeUploadedMedia } from '../../../lib/media-upload';

export const prerender = false;

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

  const target = String(form.get('target') ?? '');
  const result = await storeUploadedMedia(file, storeId);
  if (!result.ok) {
    return new Response(JSON.stringify({ ok: false, error: result.error }), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let altText: string | null = null;
  if (target === 'photo.src' && Buffer.isBuffer(result.body)) {
    altText = await generateAltText(result.body, result.contentType);
  }

  return new Response(JSON.stringify({ ok: true, url: result.url, altText }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
