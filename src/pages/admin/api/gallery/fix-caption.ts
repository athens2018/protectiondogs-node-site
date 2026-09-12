import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { checkAdminAccess } from '../../../../lib/admin-auth';

export const prerender = false;

/**
 * "AI fix" for a gallery caption: the owner jots down something rough and
 * real about a training clip, and this cleans up the grammar/phrasing into
 * one natural sentence — deliberately NOT the same job as
 * src/lib/translate.ts (which rewrites the owner's finished marketing copy
 * into other languages). This never adds marketing language or invents
 * detail the owner didn't write; it just makes what they already said read
 * cleanly, in their own voice.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const access = checkAdminAccess(cookies);
  if (!access.ok) return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401 });

  let body: { text?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Malformed request.' }), { status: 400 });
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return new Response(JSON.stringify({ ok: false, error: 'No text provided.' }), { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY is not set.' }), { status: 503 });
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 300,
      output_config: { effort: 'low' },
      system:
        'You clean up short, rough captions an owner writes for real behind-the-scenes dog-training photos/videos on a private gallery. ' +
        'Fix grammar, spelling, and awkward phrasing so it reads as one clear, natural sentence or two at most. ' +
        'Keep it authentic and plain-spoken — this is NOT marketing copy, so never add sales language, exclamation points, or ' +
        "adjectives the owner didn't use. Never invent details that weren't in the original text. If the original is already fine, return it with only minor cleanup. " +
        'Reply with ONLY the cleaned-up caption and nothing else — no quotes around it, no commentary.',
      messages: [{ role: 'user', content: text }],
    });
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    const fixed = textBlock?.text.trim();
    if (!fixed) return new Response(JSON.stringify({ ok: false, error: 'No response from AI.' }), { status: 502 });
    return new Response(JSON.stringify({ ok: true, text: fixed }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[admin/gallery/fix-caption] failed:', err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ ok: false, error: 'AI fix failed. Please try again.' }), { status: 502 });
  }
};
