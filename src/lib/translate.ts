// Auto-translation for the Dogs CMS. The admin edit form only collects
// English (see src/components/admin/LocalizedField.astro) — every other
// locale is filled in here, by asking Claude for a natural, native-sounding
// translation of each string rather than a literal word-for-word one. This
// runs in the background after the English save already went out (see
// src/pages/admin/api/dogs/save.ts), so a slow or failed translation call
// never blocks the owner's save or leaves the page hanging.
import Anthropic from '@anthropic-ai/sdk';
import type { DogEntry, LocalizedString } from './cms';

const TARGET_LOCALES = ['el', 'de', 'fr', 'ar', 'es', 'zh', 'ru', 'tr', 'it', 'pt', 'nl', 'ja'] as const;

const LOCALE_NAMES: Record<(typeof TARGET_LOCALES)[number], string> = {
  el: 'Greek',
  de: 'German',
  fr: 'French',
  ar: 'Arabic',
  es: 'Spanish',
  zh: 'Simplified Chinese',
  ru: 'Russian',
  tr: 'Turkish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  ja: 'Japanese',
};

interface Unit {
  hint: string;
  get: () => LocalizedString;
  set: (value: LocalizedString) => void;
}

/** Registers one LocalizedString-valued field on `obj[key]` as a translation unit, skipped if empty or already absent. */
function field(units: Unit[], obj: unknown, key: string, hint: string): void {
  if (!obj || typeof obj !== 'object') return;
  const record = obj as Record<string, unknown>;
  const value = record[key] as LocalizedString | undefined;
  if (!value || !value.en) return;
  units.push({
    hint,
    get: () => record[key] as LocalizedString,
    set: (next) => {
      record[key] = next;
    },
  });
}

/** Registers one LocalizedString array element (`arr[i]`) as a translation unit. */
function arrayItem(units: Unit[], arr: LocalizedString[] | undefined, i: number, hint: string): void {
  if (!arr || !arr[i] || !arr[i].en) return;
  units.push({
    hint,
    get: () => arr[i],
    set: (next) => {
      arr[i] = next;
    },
  });
}

/** Walks a DogEntry and collects every English-authored LocalizedString field that needs translating into the other 12 locales. */
function collectUnits(entry: DogEntry): Unit[] {
  const units: Unit[] = [];

  field(units, entry, 'name', 'The dog\'s display name/title. If this is a proper name (like "Bobo"), copy it unchanged into every language — never translate or transliterate a proper name. Only translate if it reads as a descriptive title (e.g. "Future Availability") rather than a name.');
  if (entry.photo) field(units, entry.photo, 'alt', 'Alt text describing a photo, for screen readers.');
  field(units, entry, 'tagline', 'A short, premium-sounding marketing tagline shown on a dog\'s card.');

  entry.stats.forEach((_, i) => {
    field(units, entry.stats[i], 'label', 'A short stat label on a dog\'s card, e.g. "Age" or "Temperament".');
    field(units, entry.stats[i], 'value', 'The value of a stat shown next to its label.');
  });

  entry.paragraphs.forEach((_, i) => arrayItem(units, entry.paragraphs, i, 'One paragraph of a dog\'s biography, written in a warm, confident tone.'));
  entry.features.forEach((_, i) => arrayItem(units, entry.features, i, 'One short checklist feature/highlight for a dog.'));

  field(units, entry, 'aboutHeading', 'A section heading, literally "About {DogName}" in English — translate the surrounding words naturally but keep the dog\'s name inside it unchanged.');
  field(units, entry, 'meetButtonLabel', 'A short button label, literally "Meet {DogName}" in English — translate the surrounding words naturally but keep the dog\'s name inside it unchanged.');

  if (entry.reservation) {
    const r = entry.reservation;
    field(units, r, 'eyebrow', 'A small eyebrow/label above the reservation price.');
    field(units, r, 'priceAmount', 'A price figure as typed by the owner, e.g. "70,000". Copy the digits and punctuation unchanged in every language — do not translate or reformat numbers.');
    r.notes.forEach((_, i) => arrayItem(units, r.notes, i, 'A short reservation note/disclaimer sentence.'));
    field(units, r, 'ctaLabel', 'A reservation call-to-action button label.');
  }

  if (entry.futureCta) field(units, entry.futureCta, 'label', 'A call-to-action button label for a future litter.');

  if (entry.story) {
    field(units, entry.story, 'title', 'The title of a "Meet the dog" story modal.');
    entry.story.slides.forEach((_, i) => {
      const slide = entry.story!.slides[i];
      field(units, slide, 'heading', 'A short heading for one slide of a story modal.');
      field(units, slide, 'body', 'The body text of one slide of a story modal, written naturally.');
    });
  }

  return units;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const body = fenced ? fenced[1] : trimmed;
  return JSON.parse(body);
}

/**
 * Returns a deep-cloned copy of `entry` with every English-only field
 * translated into the other 12 site locales via Claude. Throws on any
 * failure (missing API key, malformed response, API error) — callers should
 * treat that as "translation didn't happen this time" and keep the
 * English-only save that already succeeded rather than losing the edit.
 */
export async function translateDogEntry(entry: DogEntry): Promise<DogEntry> {
  const clone: DogEntry = JSON.parse(JSON.stringify(entry));
  const units = collectUnits(clone);
  if (units.length === 0) return clone;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const client = new Anthropic({ apiKey });

  const localeList = TARGET_LOCALES.map((l) => `${l} (${LOCALE_NAMES[l]})`).join(', ');
  const payload = units.map((u, i) => ({ id: String(i), hint: u.hint, text: u.get().en }));

  const systemPrompt = [
    'You are a professional translator for Protection Dogs GR, a Greek working-dog breeding business\'s website.',
    'Translate short marketing and site copy from English into the requested languages the way a skilled native-speaking copywriter would write it for that market — natural, fluent, idiomatic phrasing that reads as if originally written in that language, never a literal word-for-word machine translation.',
    'Keep the tone warm, confident, and premium. Preserve the exact meaning. Do not add commentary, explanations, or extra sentences.',
    'Follow each string\'s "hint" for special handling (e.g. proper names or numbers that must stay unchanged).',
    'Reply with ONLY one JSON object and nothing else — no markdown code fences, no prose before or after. Its shape is exactly: {"<id>": {"<locale code>": "<translation>", ...}, ...} — one top-level key per input id, one nested key per requested locale code, for every id and every locale.',
  ].join(' ');

  const userPrompt = `Translate each of these ${units.length} strings into all of these languages: ${localeList}.\n\nStrings:\n${JSON.stringify(payload, null, 2)}`;

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!textBlock) throw new Error(`translation response had no text block (stop_reason: ${response.stop_reason})`);

  const parsed = extractJson(textBlock.text) as Record<string, Record<string, string>>;

  for (let i = 0; i < units.length; i++) {
    const translations = parsed[String(i)];
    if (!translations) continue;
    const current = units[i].get();
    const next: LocalizedString = { ...current };
    for (const locale of TARGET_LOCALES) {
      const value = translations[locale];
      if (typeof value === 'string' && value.trim()) next[locale] = value.trim();
    }
    units[i].set(next);
  }

  return clone;
}
