import type { APIRoute } from 'astro';
import { getTestimonialsSection, saveTestimonialsSection, type TestimonialEntry } from '../../../lib/cms';
import { validateSubmittedTestimonial } from '../../../lib/testimonials-validate';
import { createRateLimiter } from '../../../lib/rate-limit';
import { notifyOwner } from '../../../lib/notify';

// Server-rendered — a public form POST, not part of the static build (see
// src/pages/api/enquiry.ts for the same convention).
export const prerender = false;

// Generous but real: a genuine client submits once, maybe retries after a
// typo. 5 per 30 minutes per IP stops casual spam scripts without needing a
// CAPTCHA for what's ultimately a low-traffic form gated by manual review
// anyway (nothing here ever reaches the public site without the owner
// approving it in /admin/testimonials/).
const submitLimiter = createRateLimiter(30 * 60 * 1000, 5);

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  // Rate-limit keyed on client IP; falls back to a shared bucket if the
  // adapter can't provide one rather than throwing (never let a rate
  // limiter itself become the outage) — same pattern as admin/api/login.ts.
  let ip = 'unknown';
  try {
    ip = clientAddress ?? 'unknown';
  } catch {
    /* not available in this environment; fall back to the shared bucket */
  }

  if (submitLimiter.isLimited(ip)) {
    return jsonError(429, 'Too many submissions. Please try again later.');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, 'Malformed submission.');
  }

  // Honeypot: a field real visitors never see or fill in (hidden via CSS
  // in the form, see src/components/sections/Testimonials.astro). Bots
  // that blindly fill every field trip this; a real submission never does.
  if (String(form.get('website') ?? '').trim()) {
    // Pretend success so a bot doesn't learn its submission was rejected.
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  submitLimiter.record(ip);

  const result = validateSubmittedTestimonial({
    name: form.get('name'),
    location: form.get('location'),
    rating: form.get('rating'),
    quote: form.get('quote'),
  });
  if (!result.ok) return jsonError(400, result.errors.join('; '));

  const current = await getTestimonialsSection();
  const entry: TestimonialEntry = {
    id: `testimonial-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: result.testimonial!.name,
    location: result.testimonial!.location,
    rating: result.testimonial!.rating,
    quote: result.testimonial!.quote,
    submittedAt: new Date().toISOString(),
    status: 'pending',
  };

  const saveResult = await saveTestimonialsSection({ ...current, items: [...current.items, entry] }, current.version);
  if (!saveResult.ok) {
    // A concurrent submission landing at the exact same moment is the only
    // realistic cause (two people submitting within the same instant) —
    // ask the visitor to just try again rather than building a retry loop
    // for what's a vanishingly rare race on a low-traffic form.
    return jsonError(503, 'Could not submit right now. Please try again.');
  }

  await notifyOwner(
    'New testimonial submitted for review',
    `${entry.name} submitted a testimonial (${entry.rating}/5 stars). Review it at:\n\nhttps://www.protectiondogs.gr/admin/testimonials/\n\n"${entry.quote}"`,
  );

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
