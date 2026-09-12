// Server-side validation for the gallery's two public/admin-authored
// shapes: an access request (src/pages/api/gallery/request.ts) and an
// admin-uploaded item (src/pages/admin/api/gallery/items.ts).
const MAX_NAME = 80;
const MAX_EMAIL = 200;
const MAX_ANSWER = 500;
const MAX_CAPTION = 240;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SubmittedGalleryRequest {
  name: string;
  email: string;
  qualifyingAnswer: string;
  dogId: string | null;
}

export interface GalleryRequestValidationResult {
  ok: boolean;
  errors: string[];
  request?: SubmittedGalleryRequest;
}

export function validateGalleryRequest(input: {
  name: unknown;
  email: unknown;
  qualifyingAnswer: unknown;
  dogId: unknown;
}): GalleryRequestValidationResult {
  const errors: string[] = [];

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) errors.push('name: required');
  if (name.length > MAX_NAME) errors.push(`name: must be ${MAX_NAME} characters or fewer`);

  const email = typeof input.email === 'string' ? input.email.trim() : '';
  if (!email || !EMAIL_RE.test(email)) errors.push('email: a valid email address is required');
  if (email.length > MAX_EMAIL) errors.push(`email: must be ${MAX_EMAIL} characters or fewer`);

  const qualifyingAnswer = typeof input.qualifyingAnswer === 'string' ? input.qualifyingAnswer.trim() : '';
  if (!qualifyingAnswer) errors.push('qualifyingAnswer: required');
  if (qualifyingAnswer.length > MAX_ANSWER) errors.push(`qualifyingAnswer: must be ${MAX_ANSWER} characters or fewer`);

  const dogId = typeof input.dogId === 'string' && input.dogId.trim() ? input.dogId.trim() : null;

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], request: { name, email, qualifyingAnswer, dogId } };
}

export interface SubmittedGalleryItem {
  caption: string;
  dogId: string | null;
  stage: string | null;
}

export interface GalleryItemValidationResult {
  ok: boolean;
  errors: string[];
  item?: SubmittedGalleryItem;
}

export function validateGalleryItemMeta(input: { caption: unknown; dogId: unknown; stage: unknown }): GalleryItemValidationResult {
  const errors: string[] = [];

  const caption = typeof input.caption === 'string' ? input.caption.trim() : '';
  if (caption.length > MAX_CAPTION) errors.push(`caption: must be ${MAX_CAPTION} characters or fewer`);

  const dogId = typeof input.dogId === 'string' && input.dogId.trim() ? input.dogId.trim() : null;
  const stage = typeof input.stage === 'string' && input.stage.trim() ? input.stage.trim() : null;

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], item: { caption, dogId, stage } };
}
