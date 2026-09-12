// Dogs CMS — data layer.
//
// One JSON document (`cms/sections/dogs.json`) in its own private Vercel
// Blob store holds the whole "Available Dogs" section, so the owner can
// edit Bobo's price (or add/retire a dog) from the admin panel at
// src/pages/admin/** without a developer touching a locale file.
//
// This supersedes src/lib/facts-merge.ts for dog-specific fields only
// (dogs.availability's sitewide count is the one exception — see
// resolveAvailableCount below). facts-merge.ts is otherwise untouched:
// pricing.cards[0].price.amount (the pricing SECTION, not this dogs list)
// still goes through it exactly as before.
//
// Store: a SEPARATE blob store from pdg-site-cache (which is
// Instagram-specific). Its read/write token is read from
// CMS_BLOB_READ_WRITE_TOKEN — deliberately NOT the ambient
// BLOB_READ_WRITE_TOKEN default (that name is already claimed by the
// Instagram store's connection) — and passed explicitly as `token` on
// every @vercel/blob call below, per @vercel/blob's own documented options
// (see node_modules/@vercel/blob/dist/index.d.ts: every put/get/head/list
// call accepts an optional `token`, defaulting to
// process.env.BLOB_READ_WRITE_TOKEN when omitted — passing it explicitly
// is exactly how two stores coexist in one project). See the deployment
// report for exactly what the owner still has to do to populate that env
// var; this module fails closed (never throws into a build/response) when
// it's missing so a not-yet-configured CMS never takes the site down.
import { get, put } from '@vercel/blob';
import dogsSeed from '../data/dogs-seed.json';

export const DOGS_SECTION_PATH = 'cms/sections/dogs.json';

/** Every editable string in the CMS is stored per-locale, English required. */
export interface LocalizedString {
  en: string;
  el?: string;
  de?: string;
  fr?: string;
  ar?: string;
  es?: string;
  zh?: string;
  ru?: string;
  tr?: string;
  it?: string;
  pt?: string;
  nl?: string;
  ja?: string;
  [locale: string]: string | undefined;
}

export interface DogStat {
  label: LocalizedString;
  value: LocalizedString;
}

export interface DogReservation {
  eyebrow: LocalizedString;
  priceCurrency: string;
  priceAmount: LocalizedString;
  notes: LocalizedString[];
  ctaLabel: LocalizedString;
  /** Must exactly match one of content.contact.form.fields.interest.options in src/i18n/locales/en.json */
  ctaInterest: string;
}

export interface DogFutureCta {
  label: LocalizedString;
  href: string;
  interest: string;
}

export interface DogStorySlide {
  /** Blob URL (or /images/... for seed data carried over from the old static assets) */
  image: string;
  video: string | null;
  heading: LocalizedString;
  body: LocalizedString;
}

export interface DogStory {
  title: LocalizedString;
  slides: DogStorySlide[];
}

export interface DogPhoto {
  src: string;
  alt: LocalizedString;
}

export type DogStatus = 'available' | 'future' | 'placed';

export interface DogEntry {
  /** Stable slug — never reuse a deleted dog's old id for an unrelated dog */
  id: string;
  status: DogStatus;
  name: LocalizedString;
  /** ISO date, or null for a "future litter" placeholder with no DOB yet */
  dob: string | null;
  photo: DogPhoto | null;
  tagline: LocalizedString;
  /** 2-4 entries */
  stats: DogStat[];
  paragraphs: LocalizedString[];
  features: LocalizedString[];
  /**
   * Not in the original data-model sketch, but required to keep
   * Dogs.astro's existing prop contract byte-for-byte (it renders an
   * "About {name}" heading and a "Meet {name}" button, both of which are
   * fully-translated strings today, not templated from `name` — see
   * src/i18n/locales/*.json's dogs.bobo.aboutHeading / meetButton.label).
   * Only present for an entry that gets the full card treatment
   * (status: 'available'); null for 'future'/'placed' entries that don't
   * render a bio panel.
   */
  aboutHeading: LocalizedString | null;
  meetButtonLabel: LocalizedString | null;
  /** Full reservation block — 'available' dogs only */
  reservation: DogReservation | null;
  /** Simpler CTA — 'future' placeholders only (mirrors today's dogs.future.cta) */
  futureCta: DogFutureCta | null;
  /** "Meet [Name]" modal; null if this dog has no story */
  story: DogStory | null;
}

export interface DogsSection {
  /** Bumped on every save; optimistic-concurrency guard against two tabs clobbering each other */
  version: number;
  updatedAt: string;
  /** Order in this array = display order */
  dogs: DogEntry[];
}

/** Resolves one localized field to `locale`'s value, falling back to English when that locale has no translation yet. Never invents text. */
export function resolveLocaleString(field: LocalizedString | null | undefined, locale: string): string {
  if (!field) return '';
  return field[locale] ?? field.en;
}

function cmsToken(): string | undefined {
  return process.env.CMS_BLOB_READ_WRITE_TOKEN;
}

/**
 * Reads the current DogsSection from the CMS blob store.
 *
 * Fails soft on every possible error (missing token, store not yet
 * connected, network hiccup, first-run "blob doesn't exist yet"): returns
 * the checked-in seed data (src/data/dogs-seed.json, itself a lossless
 * migration of what's live today — see scripts/migrate-dogs-cms.mjs)
 * instead. This is what lets `astro build` succeed even before the owner
 * has finished connecting the CMS_BLOB_READ_WRITE_TOKEN env var — the
 * static build-time fetch in HomePage.astro must never fail the whole
 * 13-locale build over a not-yet-configured CMS.
 */
export async function getDogsSection(): Promise<DogsSection> {
  const token = cmsToken();
  if (!token) {
    console.warn('[cms] CMS_BLOB_READ_WRITE_TOKEN is not set; serving the checked-in seed data for dogs.json');
    return dogsSeed as DogsSection;
  }
  try {
    const result = await get(DOGS_SECTION_PATH, { access: 'private', token, useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) {
      console.warn('[cms] dogs.json not found in the CMS blob store yet; serving the checked-in seed data');
      return dogsSeed as DogsSection;
    }
    const text = await new Response(result.stream).text();
    return JSON.parse(text) as DogsSection;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cms] failed to read dogs.json from Blob; serving the checked-in seed data:', message);
    return dogsSeed as DogsSection;
  }
}

export interface SaveResult {
  ok: boolean;
  /** Present on failure: 'stale' means the loaded version no longer matches — reload and retry. */
  error?: 'no-token' | 'stale' | 'write-failed';
  section?: DogsSection;
}

/**
 * Writes `next` to the CMS blob store, first bumping its version, but only
 * if `expectedVersion` still matches what's currently stored — the same
 * optimistic-concurrency spirit as this tool's own artifact versioning:
 * whoever saves second with a stale `expectedVersion` gets a clear
 * "someone else changed this, reload" failure instead of silently
 * clobbering the first save.
 */
export async function saveDogsSection(next: DogsSection, expectedVersion: number): Promise<SaveResult> {
  const token = cmsToken();
  if (!token) return { ok: false, error: 'no-token' };

  const current = await getDogsSection();
  if (current.version !== expectedVersion) {
    return { ok: false, error: 'stale', section: current };
  }

  const toWrite: DogsSection = {
    ...next,
    version: expectedVersion + 1,
    updatedAt: new Date().toISOString(),
  };

  try {
    await put(DOGS_SECTION_PATH, JSON.stringify(toWrite), {
      access: 'private',
      token,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
    return { ok: true, section: toWrite };
  } catch (err) {
    console.error('[cms] failed to write dogs.json to Blob:', err instanceof Error ? err.message : String(err));
    return { ok: false, error: 'write-failed' };
  }
}

/** Sitewide "currently available for reservation" count, computed directly from CMS data (see HomePage.astro for how this replaces facts.json's fact_available_for_reservation marker for the dogs section specifically). */
export function countAvailable(section: DogsSection): number {
  return section.dogs.filter((d) => d.status === 'available').length;
}
