// Server-side validation for a DogEntry submitted from the admin edit form.
// Called from src/pages/admin/api/dogs/save.ts — client-side checks in the
// form are a UX nicety only; this is the real gate, since a form's client
// JS can always be bypassed.
import type { DogEntry, DogStatus, LocalizedString } from './cms';

// Must exactly match content.contact.form.fields.interest.options in
// src/i18n/locales/en.json (excluding its blank placeholder option) — a
// typo here would silently break the enquiry form's CTA preselection.
export const ALLOWED_INTERESTS = ['Bobo - Early Reservation', 'Future Litter', 'General Enquiry', 'Other'] as const;

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  dog?: DogEntry;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isLocalizedString(v: unknown, path: string, errors: string[], required = true): v is LocalizedString {
  if (v === null || v === undefined) {
    if (required) errors.push(`${path}: required`);
    return false;
  }
  if (typeof v !== 'object') {
    errors.push(`${path}: must be an object of locale -> string`);
    return false;
  }
  const obj = v as Record<string, unknown>;
  if (!isNonEmptyString(obj.en)) {
    errors.push(`${path}.en: required, non-empty`);
    return false;
  }
  for (const [k, val] of Object.entries(obj)) {
    if (val !== undefined && typeof val !== 'string') errors.push(`${path}.${k}: must be a string`);
  }
  return true;
}

export function validateDogEntry(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null) return { ok: false, errors: ['payload must be an object'] };
  const d = input as Record<string, unknown>;

  if (!isNonEmptyString(d.id) || !ID_RE.test(d.id as string)) {
    errors.push('id: required, lowercase letters/digits/hyphens only');
  }
  const status = d.status as DogStatus;
  if (status !== 'available' && status !== 'future' && status !== 'placed') {
    errors.push('status: must be "available", "future" or "placed"');
  }
  isLocalizedString(d.name, 'name', errors);
  isLocalizedString(d.tagline, 'tagline', errors);

  if (d.dob !== null && d.dob !== undefined && (!isNonEmptyString(d.dob) || !ISO_DATE_RE.test(d.dob as string))) {
    errors.push('dob: must be null or an ISO date (YYYY-MM-DD)');
  }

  if (d.photo !== null && d.photo !== undefined) {
    const photo = d.photo as Record<string, unknown>;
    if (!isNonEmptyString(photo.src)) errors.push('photo.src: required when photo is set');
    isLocalizedString(photo.alt, 'photo.alt', errors);
  }

  const stats = Array.isArray(d.stats) ? d.stats : null;
  if (!stats || stats.length < 2 || stats.length > 4) {
    errors.push('stats: must be an array of 2-4 entries');
  } else {
    stats.forEach((s, i) => {
      const stat = s as Record<string, unknown>;
      isLocalizedString(stat.label, `stats[${i}].label`, errors);
      isLocalizedString(stat.value, `stats[${i}].value`, errors);
    });
  }

  const paragraphs = Array.isArray(d.paragraphs) ? d.paragraphs : null;
  if (!paragraphs || paragraphs.length < 1) {
    errors.push('paragraphs: at least one is required');
  } else {
    paragraphs.forEach((p, i) => isLocalizedString(p, `paragraphs[${i}]`, errors));
  }

  const features = Array.isArray(d.features) ? d.features : [];
  features.forEach((f, i) => isLocalizedString(f, `features[${i}]`, errors));

  if (status === 'available') {
    isLocalizedString(d.aboutHeading, 'aboutHeading', errors);
    isLocalizedString(d.meetButtonLabel, 'meetButtonLabel', errors);
    const r = d.reservation as Record<string, unknown> | null | undefined;
    if (!r || typeof r !== 'object') {
      errors.push('reservation: required for an "available" dog');
    } else {
      isLocalizedString(r.eyebrow, 'reservation.eyebrow', errors);
      if (!isNonEmptyString(r.priceCurrency)) errors.push('reservation.priceCurrency: required');
      isLocalizedString(r.priceAmount, 'reservation.priceAmount', errors);
      isLocalizedString(r.ctaLabel, 'reservation.ctaLabel', errors);
      if (!ALLOWED_INTERESTS.includes(r.ctaInterest as (typeof ALLOWED_INTERESTS)[number])) {
        errors.push(`reservation.ctaInterest: must be one of ${ALLOWED_INTERESTS.join(', ')}`);
      }
      const notes = Array.isArray(r.notes) ? r.notes : [];
      notes.forEach((n, i) => isLocalizedString(n, `reservation.notes[${i}]`, errors));
    }
  } else if (d.reservation) {
    errors.push('reservation: must be null unless status is "available"');
  }

  if (status === 'future' && d.futureCta) {
    const fc = d.futureCta as Record<string, unknown>;
    isLocalizedString(fc.label, 'futureCta.label', errors);
    if (!isNonEmptyString(fc.href)) errors.push('futureCta.href: required');
    if (!ALLOWED_INTERESTS.includes(fc.interest as (typeof ALLOWED_INTERESTS)[number])) {
      errors.push(`futureCta.interest: must be one of ${ALLOWED_INTERESTS.join(', ')}`);
    }
  } else if (status !== 'future' && d.futureCta) {
    errors.push('futureCta: must be null unless status is "future"');
  }

  if (d.story) {
    const story = d.story as Record<string, unknown>;
    isLocalizedString(story.title, 'story.title', errors);
    const slides = Array.isArray(story.slides) ? story.slides : null;
    if (!slides || slides.length < 2 || slides.length > 6) {
      errors.push('story.slides: must be an array of 2-6 entries');
    } else {
      slides.forEach((s, i) => {
        const slide = s as Record<string, unknown>;
        if (!isNonEmptyString(slide.image)) errors.push(`story.slides[${i}].image: required`);
        if (slide.video !== null && slide.video !== undefined && !isNonEmptyString(slide.video)) {
          errors.push(`story.slides[${i}].video: must be null or a non-empty string`);
        }
        isLocalizedString(slide.heading, `story.slides[${i}].heading`, errors);
        isLocalizedString(slide.body, `story.slides[${i}].body`, errors);
      });
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], dog: input as DogEntry };
}
