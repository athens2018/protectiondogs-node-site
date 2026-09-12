#!/usr/bin/env node
// One-off migration: builds the seed src/data/dogs-seed.json for the new
// Dogs CMS (src/lib/cms.ts) by losslessly carrying forward the "bobo" and
// "future" dog entries, and the "Meet Bobo" story-modal slides, out of
// every one of the 13 locale JSON files plus src/data/facts.json.
//
// Why this exists at all: today those fields live as translated strings in
// src/i18n/locales/<code>.json, with a handful of them containing
// <!--pdg:KEY--> marker spans that src/lib/facts-merge.ts patches at build
// time from src/data/facts.json. The CMS retires that marker mechanism for
// dogs specifically — the owner will type the real display value directly
// going forward — so this script resolves every marker to its CURRENT
// per-locale rendered value (exactly what facts-merge.ts would have
// produced today) and bakes that plain string into the seed data. Nothing
// is translated or invented here: every non-English string is copied
// verbatim from its own locale file.
//
// Run once: `node scripts/migrate-dogs-cms.mjs`. Not part of the build.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const LOCALES = ['en', 'el', 'de', 'fr', 'ar', 'es', 'zh', 'ru', 'tr', 'it', 'pt', 'nl', 'ja'];

const facts = JSON.parse(readFileSync(path.join(ROOT, 'src/data/facts.json'), 'utf8'));

function readLocale(code) {
  return JSON.parse(readFileSync(path.join(ROOT, `src/i18n/locales/${code}.json`), 'utf8'));
}

/** Mirrors facts-merge.ts's replaceMarker: resolves a single <!--pdg:KEY-->...<!--/pdg--> span to `value`, or returns the input untouched if the marker isn't present (already-plain fields have no marker at all). */
function resolveMarker(html, markerKey, value) {
  if (typeof html !== 'string') return html;
  const re = new RegExp(`<!--pdg:${markerKey}-->[\\s\\S]*?<!--/pdg-->`);
  return re.test(html) ? html.replace(re, value) : html;
}

/** Builds a LocalizedString map { en, el, de, ... } by calling `pick(localeContent, format)` for every locale. */
function localize(pick) {
  const out = {};
  for (const code of LOCALES) {
    const content = readLocale(code);
    const format = facts.formats[code];
    const value = pick(content, format, code);
    if (value !== undefined && value !== null) out[code] = value;
  }
  // en is required by the schema — verify it's really there.
  if (typeof out.en !== 'string') throw new Error('Missing required "en" value while building a LocalizedString');
  return out;
}

function localizeArray(pickArray) {
  const perLocale = {};
  for (const code of LOCALES) {
    const content = readLocale(code);
    perLocale[code] = pickArray(content, code) ?? [];
  }
  const length = perLocale.en.length;
  const result = [];
  for (let i = 0; i < length; i++) {
    result.push(localize((content, format, code) => perLocale[code][i]));
  }
  return result;
}

const en = readLocale('en');

// ---------- "bobo" (status: available) ----------
const bobo = {
  id: 'bobo',
  status: 'available',
  name: localize((c) => c.dogs.bobo.name),
  dob: facts.facts.dog_dob_iso,
  photo: {
    src: en.dogs.bobo.image.src,
    alt: localize((c) => c.dogs.bobo.image.alt),
  },
  tagline: localize((c, f) => resolveMarker(c.dogs.bobo.tagline, 'stage_display', f.stage_display)),
  stats: [
    {
      label: localize((c) => c.dogs.bobo.stats[0].label),
      value: localize((c, f) => resolveMarker(c.dogs.bobo.stats[0].value, 'dob_display', f.dob_display)),
    },
    {
      label: localize((c) => c.dogs.bobo.stats[1].label),
      value: localize((c) => c.dogs.bobo.stats[1].value),
    },
    {
      label: localize((c) => c.dogs.bobo.stats[2].label),
      value: localize((c, f) => resolveMarker(c.dogs.bobo.stats[2].value, 'status_display', f.status_display)),
    },
  ],
  aboutHeading: localize((c) => c.dogs.bobo.aboutHeading),
  meetButtonLabel: localize((c) => c.dogs.bobo.meetButton.label),
  paragraphs: localizeArray((c) => c.dogs.bobo.paragraphs),
  features: localizeArray((c) => c.dogs.bobo.features),
  reservation: {
    eyebrow: localize((c) => c.dogs.bobo.reservation.eyebrow),
    priceCurrency: en.dogs.bobo.reservation.price.currency,
    priceAmount: localize((c, f) => resolveMarker(c.dogs.bobo.reservation.price.amount, 'price_current', f.price_current)),
    // notes[0] embeds a fully-authored, grammatical price_future sentence in
    // every locale (see facts-merge.ts's comment on this exact field) — it
    // is intentionally NOT further marker-resolved here, only carried
    // verbatim, same as facts-merge.ts leaves it alone today.
    notes: localizeArray((c) => c.dogs.bobo.reservation.notes),
    ctaLabel: localize((c) => c.dogs.bobo.reservation.cta.label),
    ctaInterest: en.dogs.bobo.reservation.cta.data['data-interest'],
  },
  futureCta: null,
  story: {
    title: localize((c) => c.boboStory.title),
    slides: en.boboStory.slides.map((_, i) => ({
      image: en.boboStory.slides[i].image,
      video: en.boboStory.slides[i].video,
      heading: localize((c) => c.boboStory.slides[i].h4),
      body: localize((c) => c.boboStory.slides[i].p),
    })),
  },
};

// ---------- "future-availability" (status: future) ----------
const futureAvailability = {
  id: 'future-availability',
  status: 'future',
  name: localize((c) => c.dogs.future.name),
  dob: null,
  photo: null,
  tagline: localize((c) => c.dogs.future.tagline),
  stats: [
    {
      label: localize((c, f) => resolveMarker(c.dogs.future.stats[0].label, 'next_litter_label', f.next_litter_label)),
      value: localize((c, f) => resolveMarker(c.dogs.future.stats[0].value, 'next_litter', f.next_litter)),
    },
    {
      label: localize((c) => c.dogs.future.stats[1].label),
      value: localize((c) => c.dogs.future.stats[1].value),
    },
    {
      label: localize((c) => c.dogs.future.stats[2].label),
      value: localize((c) => c.dogs.future.stats[2].value),
    },
  ],
  aboutHeading: null,
  meetButtonLabel: null,
  paragraphs: [localize((c) => c.dogs.future.paragraph)],
  features: [],
  reservation: null,
  futureCta: {
    label: localize((c) => c.dogs.future.cta.label),
    href: en.dogs.future.cta.href,
    interest: en.dogs.future.cta.data['data-interest'],
  },
  story: null,
};

const section = {
  version: 1,
  updatedAt: new Date().toISOString(),
  dogs: [bobo, futureAvailability],
};

const outPath = path.join(ROOT, 'src/data/dogs-seed.json');
writeFileSync(outPath, JSON.stringify(section, null, 2) + '\n', 'utf8');
console.log(`Wrote ${outPath}`);
console.log(`  bobo.tagline.el = ${JSON.stringify(bobo.tagline.el)}`);
console.log(`  bobo.reservation.priceAmount.el = ${JSON.stringify(bobo.reservation.priceAmount.el)}`);
console.log(`  futureAvailability.stats[0].value.ja = ${JSON.stringify(futureAvailability.stats[0].value.ja)}`);
