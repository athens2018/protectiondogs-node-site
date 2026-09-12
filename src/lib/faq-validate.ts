// Server-side validation for a FaqSection submitted from the admin edit
// form. Called from src/pages/admin/api/faq/save.ts — mirrors
// src/lib/dogs-validate.ts's approach, much shorter since FAQ has no media
// or nested optional blocks.
import type { FaqSection, LocalizedString } from './cms';

export interface FaqValidationResult {
  ok: boolean;
  errors: string[];
  section?: Pick<FaqSection, 'eyebrow' | 'heading' | 'items'>;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isLocalizedString(v: unknown, path: string, errors: string[]): v is LocalizedString {
  if (typeof v !== 'object' || v === null) {
    errors.push(`${path}: required`);
    return false;
  }
  if (!isNonEmptyString((v as Record<string, unknown>).en)) {
    errors.push(`${path}.en: required, non-empty`);
    return false;
  }
  return true;
}

export function validateFaqSection(input: unknown): FaqValidationResult {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null) return { ok: false, errors: ['payload must be an object'] };
  const d = input as Record<string, unknown>;

  isLocalizedString(d.eyebrow, 'eyebrow', errors);
  isLocalizedString(d.heading, 'heading', errors);

  const items = Array.isArray(d.items) ? d.items : null;
  if (!items || items.length < 1) {
    errors.push('items: at least one question is required');
  } else {
    items.forEach((item, i) => {
      const it = item as Record<string, unknown>;
      if (!isNonEmptyString(it.id)) errors.push(`items[${i}].id: required`);
      isLocalizedString(it.question, `items[${i}].question`, errors);
      isLocalizedString(it.answer, `items[${i}].answer`, errors);
    });
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    section: d as unknown as Pick<FaqSection, 'eyebrow' | 'heading' | 'items'>,
  };
}
