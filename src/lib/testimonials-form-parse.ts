// Reconstructs a raw TestimonialEntry[]-shaped array out of the admin
// testimonials form's FormData. Mirrors src/lib/faq-form-parse.ts's
// dotted-path convention (`items.0.name`, etc.).
function str(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

export function parseTestimonialsForm(form: FormData, maxItems: number): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < maxItems; i++) {
    if (str(form, `remove.items.${i}`) === 'on') continue;
    const name = str(form, `items.${i}.name`);
    const quote = str(form, `items.${i}.quote`);
    if (!name || !quote) continue; // an untouched spare slot
    const id = str(form, `items.${i}.id`) || `testimonial-${Date.now()}-${i}`;
    const location = str(form, `items.${i}.location`);
    const rating = Number(str(form, `items.${i}.rating`)) || 5;
    const status = str(form, `items.${i}.status`) || 'approved';
    const submittedAt = str(form, `items.${i}.submittedAt`) || new Date().toISOString();
    rows.push({ id, name, location: location || null, rating, quote, status, submittedAt });
  }
  return rows;
}
