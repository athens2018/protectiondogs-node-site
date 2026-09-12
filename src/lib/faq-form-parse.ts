// Reconstructs a raw FaqSection-shaped object out of the admin FAQ form's
// FormData. Mirrors src/lib/dog-form-parse.ts's dotted-path convention
// (`items.0.question.en`, etc.); src/lib/faq-validate.ts does the actual
// acceptance/rejection.
function str(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

/** A LocalizedString from `${prefix}.en` — every other locale is filled in automatically by translation, never collected here (see src/components/admin/LocalizedField.astro). */
function localized(form: FormData, prefix: string): { en: string } | null {
  const en = str(form, `${prefix}.en`);
  return en ? { en } : null;
}

export function parseFaqForm(form: FormData, maxItems: number): Record<string, unknown> {
  const eyebrow = localized(form, 'eyebrow') ?? { en: '' };
  const heading = localized(form, 'heading') ?? { en: '' };

  const rows: { id: string; position: number; question: { en: string }; answer: { en: string } }[] = [];
  for (let i = 0; i < maxItems; i++) {
    if (str(form, `remove.items.${i}`) === 'on') continue;
    const question = localized(form, `items.${i}.question`);
    const answer = localized(form, `items.${i}.answer`);
    if (!question || !answer) continue;
    const id = str(form, `items.${i}.id`) || `faq-q${Date.now()}-${i}`;
    const position = Number(str(form, `items.${i}.position`)) || 999;
    rows.push({ id, position, question, answer });
  }
  rows.sort((a, b) => a.position - b.position);

  return {
    eyebrow,
    heading,
    items: rows.map(({ position: _position, ...rest }) => rest),
  };
}
