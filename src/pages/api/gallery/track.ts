import type { APIRoute } from 'astro';
import { getGallerySection, recordGalleryMutation } from '../../../lib/cms';
import { accessTokenMatches } from '../../../lib/gallery-auth';

export const prerender = false;

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export const POST: APIRoute = async ({ request }) => {
  let body: { token?: string; action?: string; itemId?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Malformed request.');
  }

  const token = typeof body.token === 'string' ? body.token : '';
  if (!token) return jsonError(400, 'Missing token.');

  const section = await getGallerySection();
  const visitor = section.visitors.find((v) => v.status === 'approved' && v.accessTokenHash && accessTokenMatches(token, v.accessTokenHash));
  if (!visitor) return jsonError(403, 'Invalid or revoked access.');
  const visitorId = visitor.id;

  if (body.action === 'interest') {
    const itemId = typeof body.itemId === 'string' ? body.itemId : '';
    if (!itemId) return jsonError(400, 'Missing itemId.');
    await recordGalleryMutation((current) => ({
      ...current,
      items: current.items.map((i) => (i.id === itemId ? { ...i, interestCount: i.interestCount + 1 } : i)),
    }));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (body.action === 'contact') {
    await recordGalleryMutation((current) => ({
      ...current,
      visitors: current.visitors.map((v) => (v.id === visitorId && !v.contactedAt ? { ...v, contactedAt: new Date().toISOString() } : v)),
    }));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  return jsonError(400, `Unknown action "${body.action}".`);
};
