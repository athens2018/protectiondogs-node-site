// One-off migration: builds src/data/faq-seed.json (the FAQ CMS section's
// checked-in fallback/seed) losslessly from the 13 existing per-locale
// src/i18n/locales/*.json files, matching items across locales by their
// stable "id" (e.g. "faq-q1") rather than by array position. Mirrors
// scripts/migrate-dogs-cms.mjs's approach for the Dogs CMS.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const LOCALES = ['en', 'el', 'de', 'fr', 'ar', 'es', 'zh', 'ru', 'tr', 'it', 'pt', 'nl', 'ja'];

function readLocale(code) {
  return JSON.parse(readFileSync(path.join(root, 'src/i18n/locales', `${code}.json`), 'utf8'));
}

function localize(perLocaleValue) {
  const out = { en: perLocaleValue.en };
  for (const code of LOCALES) {
    if (code === 'en') continue;
    if (perLocaleValue[code] !== undefined) out[code] = perLocaleValue[code];
  }
  return out;
}

const byLocale = Object.fromEntries(LOCALES.map((code) => [code, readLocale(code).faq]));
const en = byLocale.en;

const eyebrow = localize(Object.fromEntries(LOCALES.map((code) => [code, byLocale[code].eyebrow])));
const heading = localize(Object.fromEntries(LOCALES.map((code) => [code, byLocale[code].h2])));

const items = en.items.map((enItem) => {
  const question = {};
  const answer = {};
  for (const code of LOCALES) {
    const localeItem = byLocale[code].items.find((i) => i.id === enItem.id);
    if (!localeItem) continue;
    question[code] = localeItem.question;
    answer[code] = localeItem.answer;
  }
  return { id: enItem.id, question: localize(question), answer: localize(answer) };
});

const seed = {
  version: 1,
  updatedAt: new Date().toISOString(),
  eyebrow,
  heading,
  items,
};

writeFileSync(path.join(root, 'src/data/faq-seed.json'), JSON.stringify(seed, null, 2) + '\n');
console.log(`Wrote src/data/faq-seed.json — ${items.length} FAQ items across ${LOCALES.length} locales.`);
