import type { APIRoute } from 'astro';
import { getGallerySection, saveGallerySection, type GalleryVisitor } from '../../../lib/cms';
import { validateGalleryRequest } from '../../../lib/gallery-validate';
import { createRateLimiter } from '../../../lib/rate-limit';
import { geolocateIp } from '../../../lib/geolocate';
import { notifyOwner } from '../../../lib/notify';

export const prerender = false;

// Same reasoning as src/pages/api/testimonials/submit.ts's limiter — a
// genuine visitor requests access once, not repeatedly.
const requestLimiter = createRateLimiter(30 * 60 * 1000, 5);

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let ip = 'unknown';
  try {
    ip = clientAddress ?? 'unknown';
  } catch {
    /* not available in this environment; fall back to the shared bucket */
  }

  if (requestLimiter.isLimited(ip)) {
    return jsonError(429, 'Too many requests. Please try again later.');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, 'Malformed submission.');
  }

  // Honeypot — see testimonials/submit.ts for the same convention.
  if (String(form.get('website') ?? '').trim()) {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  requestLimiter.record(ip);

  const result = validateGalleryRequest({
    name: form.get('name'),
    email: form.get('email'),
    qualifyingAnswer: form.get('qualifyingAnswer'),
    dogId: form.get('dogId'),
  });
  if (!result.ok) return jsonError(400, result.errors.join('; '));

  const geo = await geolocateIp(ip);

  const current = await getGallerySection();

  const existing = current.visitors.find((v) => v.email.toLowerCase() === result.request!.email.toLowerCase());
  if (existing && existing.status !== 'revoked') {
    // Already requested (or already approved) — don't create a duplicate
    // pending entry; just let them know their existing request's status.
    return new Response(
      JSON.stringify({
        ok: true,
        alreadyRequested: true,
        message:
          existing.status === 'approved'
            ? 'You already have access — check your email for the link, or it may already be in your browser.'
            : 'You already have a request pending review.',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const visitor: GalleryVisitor = {
    id: `visitor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: result.request!.name,
    email: result.request!.email,
    qualifyingAnswer: result.request!.qualifyingAnswer,
    dogId: result.request!.dogId,
    locationCountry: geo.country,
    locationCity: geo.city,
    status: 'pending',
    accessTokenHash: null,
    requestedAt: new Date().toISOString(),
    approvedAt: null,
    lastVisitAt: null,
    totalViews: 0,
    itemViews: {},
    contactedAt: null,
  };

  const saveResult = await saveGallerySection({ ...current, visitors: [...current.visitors, visitor] }, current.version);
  if (!saveResult.ok) {
    return jsonError(503, 'Could not submit right now. Please try again.');
  }

  await notifyOwner(
    'New gallery access request',
    [
      `${visitor.name} (${visitor.email}) requested access to the private gallery.`,
      visitor.locationCity || visitor.locationCountry ? `Location: ${[visitor.locationCity, visitor.locationCountry].filter(Boolean).join(', ')}` : '',
      visitor.dogId ? `Interested in: ${visitor.dogId}` : '',
      `Their answer: "${visitor.qualifyingAnswer}"`,
      '',
      'Review it at: https://www.protectiondogs.gr/admin/gallery/',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
