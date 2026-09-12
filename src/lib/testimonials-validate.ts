// Server-side validation for a testimonial, shared by the public submission
// endpoint (src/pages/api/testimonials/submit.ts) and the admin panel
// (src/pages/admin/api/testimonials/save.ts).
import type { TestimonialEntry, TestimonialStatus } from './cms';

const MAX_NAME = 80;
const MAX_LOCATION = 80;
const MAX_QUOTE = 4000;
const STATUSES: TestimonialStatus[] = ['pending', 'approved', 'rejected'];

export interface SubmittedTestimonial {
  name: string;
  location: string | null;
  rating: number;
  quote: string;
}

export interface TestimonialValidationResult {
  ok: boolean;
  errors: string[];
  testimonial?: SubmittedTestimonial;
}

/** Validates a public submission's raw form fields — deliberately stricter/simpler than the admin path below (untrusted input). */
export function validateSubmittedTestimonial(input: {
  name: unknown;
  location: unknown;
  rating: unknown;
  quote: unknown;
}): TestimonialValidationResult {
  const errors: string[] = [];

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) errors.push('name: required');
  if (name.length > MAX_NAME) errors.push(`name: must be ${MAX_NAME} characters or fewer`);

  const locationRaw = typeof input.location === 'string' ? input.location.trim() : '';
  if (locationRaw.length > MAX_LOCATION) errors.push(`location: must be ${MAX_LOCATION} characters or fewer`);

  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.push('rating: must be a whole number from 1 to 5');

  const quote = typeof input.quote === 'string' ? input.quote.trim() : '';
  if (!quote) errors.push('quote: required');
  if (quote.length > MAX_QUOTE) errors.push(`quote: must be ${MAX_QUOTE} characters or fewer`);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    testimonial: { name, location: locationRaw || null, rating, quote },
  };
}

/** Validates the admin "add a testimonial directly" form — same rules, kept separate so the two call sites can diverge later without cross-talk. */
export function validateAdminTestimonial(input: {
  name: unknown;
  location: unknown;
  rating: unknown;
  quote: unknown;
}): TestimonialValidationResult {
  return validateSubmittedTestimonial(input);
}

export interface TestimonialsListValidationResult {
  ok: boolean;
  errors: string[];
  items?: TestimonialEntry[];
}

/** Validates the whole admin testimonials list submitted from src/pages/admin/testimonials/index.astro's one big form. */
export function validateTestimonialsList(rows: Record<string, unknown>[]): TestimonialsListValidationResult {
  const errors: string[] = [];
  const items: TestimonialEntry[] = [];

  rows.forEach((row, i) => {
    const base = validateSubmittedTestimonial({
      name: row.name,
      location: row.location,
      rating: row.rating,
      quote: row.quote,
    });
    if (!base.ok) {
      errors.push(...base.errors.map((e) => `items[${i}].${e}`));
      return;
    }
    const status = row.status as TestimonialStatus;
    if (!STATUSES.includes(status)) {
      errors.push(`items[${i}].status: must be one of ${STATUSES.join(', ')}`);
      return;
    }
    const id = typeof row.id === 'string' && row.id ? row.id : `testimonial-${Date.now()}-${i}`;
    const submittedAt = typeof row.submittedAt === 'string' && row.submittedAt ? row.submittedAt : new Date().toISOString();
    items.push({ id, name: base.testimonial!.name, location: base.testimonial!.location, rating: base.testimonial!.rating, quote: base.testimonial!.quote, status, submittedAt });
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], items };
}
