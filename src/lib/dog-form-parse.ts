// Reconstructs a raw DogEntry-shaped object out of the admin edit form's
// FormData. The form is plain HTML (progressive enhancement: it works
// with JS disabled, no client-side framework, matching the rest of this
// project's dependency-light conventions) — every field name follows a
// dotted-path convention (`stats.0.label.en`, `story.slides.2.image`,
// etc.) that this module knows how to walk back into nested objects.
// src/lib/dogs-validate.ts does the actual acceptance/rejection; this
// module only reshapes + prunes empty rows/locales.
const LOCALES = ['en', 'el', 'de', 'fr', 'ar', 'es', 'zh', 'ru', 'tr', 'it', 'pt', 'nl', 'ja'];

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

/** A LocalizedString from `${prefix}.en`, `${prefix}.el`, ... — omits any locale left blank, so resolveLocaleString's English fallback applies instead of showing an empty string. */
function localized(form: FormData, prefix: string): Record<string, string> | null {
  const en = str(form, `${prefix}.en`);
  if (!en) return null;
  const out: Record<string, string> = { en };
  for (const locale of LOCALES) {
    if (locale === 'en') continue;
    const v = str(form, `${prefix}.${locale}`);
    if (v) out[locale] = v;
  }
  return out;
}

function readIndexedRows<T>(
  form: FormData,
  prefix: string,
  maxRows: number,
  build: (rowPrefix: string, i: number) => T | null,
): T[] {
  const rows: T[] = [];
  for (let i = 0; i < maxRows; i++) {
    if (str(form, `remove.${prefix}.${i}`) === 'on') continue;
    const row = build(`${prefix}.${i}`, i);
    if (row !== null) rows.push(row);
  }
  return rows;
}

export function parseDogForm(form: FormData): Record<string, unknown> {
  const status = str(form, 'status');
  const id = str(form, 'id');
  const dob = str(form, 'dob');

  const photoSrc = str(form, 'photo.src');
  const photoAlt = localized(form, 'photo.alt');
  const photo = photoSrc ? { src: photoSrc, alt: photoAlt ?? { en: '' } } : null;

  const stats = readIndexedRows(form, 'stats', 4, (p) => {
    const label = localized(form, `${p}.label`);
    const value = localized(form, `${p}.value`);
    return label && value ? { label, value } : null;
  });

  const paragraphs = readIndexedRows(form, 'paragraphs', 8, (p) => localized(form, p));
  const features = readIndexedRows(form, 'features', 10, (p) => localized(form, p));

  const hasReservation = status === 'available';
  const reservation = hasReservation
    ? {
        eyebrow: localized(form, 'reservation.eyebrow') ?? { en: '' },
        priceCurrency: str(form, 'reservation.priceCurrency') || 'EUR',
        priceAmount: localized(form, 'reservation.priceAmount') ?? { en: '' },
        notes: readIndexedRows(form, 'reservation.notes', 4, (p) => localized(form, p)),
        ctaLabel: localized(form, 'reservation.ctaLabel') ?? { en: '' },
        ctaInterest: str(form, 'reservation.ctaInterest'),
      }
    : null;

  const hasFutureCta = status === 'future' && str(form, 'futureCta.enabled') === 'on';
  const futureCta = hasFutureCta
    ? {
        label: localized(form, 'futureCta.label') ?? { en: '' },
        href: str(form, 'futureCta.href') || '#contact',
        interest: str(form, 'futureCta.interest'),
      }
    : null;

  const storyEnabled = str(form, 'story.enabled') === 'on';
  const slides = storyEnabled
    ? readIndexedRows(form, 'story.slides', 6, (p) => {
        const image = str(form, `${p}.image`);
        const video = str(form, `${p}.video`) || null;
        const heading = localized(form, `${p}.heading`);
        const body = localized(form, `${p}.body`);
        const position = Number(str(form, `${p}.position`)) || 999;
        return image && heading && body ? { image, video, heading, body, position } : null;
      })
        .sort((a, b) => a.position - b.position)
        .map(({ position: _position, ...rest }) => rest)
    : [];
  const story = storyEnabled ? { title: localized(form, 'story.title') ?? { en: '' }, slides } : null;

  return {
    id,
    status,
    name: localized(form, 'name') ?? { en: '' },
    dob: dob || null,
    photo,
    tagline: localized(form, 'tagline') ?? { en: '' },
    stats,
    paragraphs,
    features,
    aboutHeading: status === 'available' ? localized(form, 'aboutHeading') ?? { en: '' } : null,
    meetButtonLabel: status === 'available' ? localized(form, 'meetButtonLabel') ?? { en: '' } : null,
    reservation,
    futureCta,
    story,
  };
}
