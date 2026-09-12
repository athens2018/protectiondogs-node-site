// CMS data layer — one JSON document per section (e.g.
// `cms/sections/dogs.json`, `cms/sections/faq.json`) in a private Vercel
// Blob store, so the owner can edit content from the admin panel at
// src/pages/admin/** without a developer touching a locale file.
//
// This supersedes src/lib/facts-merge.ts for the fields each section here
// covers (dogs.availability's sitewide count is the one dogs-specific
// exception — see countAvailable below). facts-merge.ts is otherwise
// untouched for anything not yet migrated to a CMS section here.
//
// Store: a SEPARATE blob store from pdg-site-cache (which is
// Instagram-specific). When the owner connected it via the Vercel
// dashboard, Vercel did NOT issue a classic long-lived
// BLOB_READ_WRITE_TOKEN for it — @vercel/blob 2.8.0's dashboard flow
// instead wires up its newer OIDC-based auth: it created
// CMS_BLOB_READ_WRITE_TOKEN_STORE_ID (and a _WEBHOOK_PUBLIC_KEY, unused
// here) and relies on Vercel's ambient VERCEL_OIDC_TOKEN (auto-injected
// into every Function at runtime, never something this code reads
// itself) for the actual credential. Per
// node_modules/@vercel/blob/dist/index.d.ts's own documented options:
// "storeId ... Used to override process.env.BLOB_STORE_ID when Vercel
// OIDC token is available" — passing storeId explicitly (rather than the
// project-ambient BLOB_STORE_ID, which is already the Instagram store's)
// is exactly how two stores coexist in one project under this auth mode.
// This only works when actually deployed on Vercel (OIDC token isn't
// present in a bare local build) — every store below fails closed (never
// throws into a build/response) when the store id is missing so a
// not-yet-configured or locally-run CMS never takes the site down.
import { get, put, list, del } from '@vercel/blob';
import dogsSeed from '../data/dogs-seed.json';
import faqSeed from '../data/faq-seed.json';
import testimonialsSeed from '../data/testimonials-seed.json';

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

/** Resolves one localized field to `locale`'s value, falling back to English when that locale has no translation yet. Never invents text. */
export function resolveLocaleString(field: LocalizedString | null | undefined, locale: string): string {
  if (!field) return '';
  return field[locale] ?? field.en;
}

function cmsStoreId(): string | undefined {
  return process.env.CMS_BLOB_READ_WRITE_TOKEN_STORE_ID;
}

export interface SaveResult<T> {
  ok: boolean;
  /** Present on failure: 'stale' means the loaded version no longer matches — reload and retry. */
  error?: 'no-store' | 'stale' | 'write-failed';
  section?: T;
}

export interface HistoryEntry {
  version: number;
  updatedAt: string;
}

interface VersionedSection {
  /** Bumped on every save; optimistic-concurrency guard against two tabs clobbering each other */
  version: number;
  updatedAt: string;
}

/**
 * One section's read/write/history/rollback logic, generalized so a new CMS
 * section (see src/pages/admin/faq/** for the second one) is a small seed
 * file plus one call here rather than a second copy of this whole file.
 */
function createSectionStore<T extends VersionedSection>(opts: {
  /** e.g. 'cms/sections/faq.json' */
  path: string;
  /** e.g. 'cms/history/faq/' — must be unique per section and end with '/' */
  historyPrefix: string;
  /** Checked-in fallback (e.g. src/data/faq-seed.json) served whenever the store isn't reachable, so a build/request never fails over a CMS hiccup. */
  seed: T;
  historyKeep?: number;
}) {
  const { path, historyPrefix, seed } = opts;
  const historyKeep = opts.historyKeep ?? 30;

  function parseHistoryVersion(pathname: string): number | null {
    if (!pathname.startsWith(historyPrefix)) return null;
    const version = Number(pathname.slice(historyPrefix.length).replace(/\.json$/, ''));
    return Number.isFinite(version) ? version : null;
  }

  async function pruneHistory(storeId: string): Promise<void> {
    const { blobs } = await list({ prefix: historyPrefix, storeId, limit: 1000 });
    const versioned = blobs
      .map((b) => ({ url: b.url, version: parseHistoryVersion(b.pathname) }))
      .filter((b): b is { url: string; version: number } => b.version !== null)
      .sort((a, b) => b.version - a.version);
    const toDelete = versioned.slice(historyKeep).map((b) => b.url);
    if (toDelete.length > 0) await del(toDelete, { storeId });
  }

  async function getSection(): Promise<T> {
    const storeId = cmsStoreId();
    if (!storeId) {
      console.warn(`[cms] CMS_BLOB_READ_WRITE_TOKEN_STORE_ID is not set; serving the checked-in seed data for ${path}`);
      return seed;
    }
    try {
      const result = await get(path, { access: 'private', storeId, useCache: false });
      if (!result || result.statusCode !== 200 || !result.stream) {
        console.warn(`[cms] ${path} not found in the CMS blob store yet; serving the checked-in seed data`);
        return seed;
      }
      const text = await new Response(result.stream).text();
      return JSON.parse(text) as T;
    } catch (err) {
      console.error(`[cms] failed to read ${path} from Blob; serving the checked-in seed data:`, err instanceof Error ? err.message : String(err));
      return seed;
    }
  }

  /**
   * Writes `next`, first bumping its version, but only if `expectedVersion`
   * still matches what's currently stored: whoever saves second with a
   * stale `expectedVersion` gets a clear "someone else changed this,
   * reload" failure instead of silently clobbering the first save.
   */
  async function saveSection(next: T, expectedVersion: number): Promise<SaveResult<T>> {
    const storeId = cmsStoreId();
    if (!storeId) return { ok: false, error: 'no-store' };

    const current = await getSection();
    if (current.version !== expectedVersion) {
      return { ok: false, error: 'stale', section: current };
    }

    const toWrite: T = { ...next, version: expectedVersion + 1, updatedAt: new Date().toISOString() };

    try {
      await put(path, JSON.stringify(toWrite), {
        access: 'private',
        storeId,
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      });
    } catch (err) {
      console.error(`[cms] failed to write ${path} to Blob:`, err instanceof Error ? err.message : String(err));
      return { ok: false, error: 'write-failed' };
    }

    // Best-effort version snapshot for rollback — a failure here must never
    // fail the save itself, since the live document above already wrote
    // successfully.
    try {
      await put(`${historyPrefix}${toWrite.version}.json`, JSON.stringify(toWrite), {
        access: 'private',
        storeId,
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      });
      await pruneHistory(storeId);
    } catch (err) {
      console.error(`[cms] failed to write history snapshot for ${path}:`, err instanceof Error ? err.message : String(err));
    }

    return { ok: true, section: toWrite };
  }

  /** Lists past saved versions, newest first, for a section's "History" admin page. */
  async function listHistory(limit = historyKeep): Promise<HistoryEntry[]> {
    const storeId = cmsStoreId();
    if (!storeId) return [];
    try {
      const { blobs } = await list({ prefix: historyPrefix, storeId, limit: 1000 });
      return blobs
        .map((b) => {
          const version = parseHistoryVersion(b.pathname);
          return version === null ? null : { version, updatedAt: b.uploadedAt.toISOString() };
        })
        .filter((entry): entry is HistoryEntry => entry !== null)
        .sort((a, b) => b.version - a.version)
        .slice(0, limit);
    } catch (err) {
      console.error(`[cms] failed to list history for ${path}:`, err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  /** Reads one historical snapshot by version number. */
  async function getHistoryVersion(version: number): Promise<T | null> {
    const storeId = cmsStoreId();
    if (!storeId) return null;
    try {
      const result = await get(`${historyPrefix}${version}.json`, { access: 'private', storeId, useCache: false });
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      const text = await new Response(result.stream).text();
      return JSON.parse(text) as T;
    } catch (err) {
      console.error(`[cms] failed to read history version for ${path}:`, err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  /**
   * Restores a historical snapshot's content as the new current version —
   * this becomes a new, further-undoable version rather than rewinding
   * version numbers, so history stays a simple, append-only log and an
   * accidental restore is itself never unrecoverable.
   */
  async function restoreHistoryVersion(version: number): Promise<SaveResult<T>> {
    const snapshot = await getHistoryVersion(version);
    if (!snapshot) return { ok: false, error: 'write-failed' };
    const current = await getSection();
    const { version: _v, updatedAt: _u, ...content } = snapshot;
    return saveSection({ ...current, ...content } as T, current.version);
  }

  return { getSection, saveSection, listHistory, getHistoryVersion, restoreHistoryVersion };
}

// ---------------------------------------------------------------------------
// Dogs section
// ---------------------------------------------------------------------------

export const DOGS_SECTION_PATH = 'cms/sections/dogs.json';

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

export interface DogsSection extends VersionedSection {
  /** Order in this array = display order */
  dogs: DogEntry[];
}

const dogsStore = createSectionStore<DogsSection>({
  path: DOGS_SECTION_PATH,
  historyPrefix: 'cms/history/dogs/',
  seed: dogsSeed as DogsSection,
});

export const getDogsSection = dogsStore.getSection;
export const saveDogsSection = dogsStore.saveSection;
export const listDogsHistory = dogsStore.listHistory;
export const getDogsHistoryVersion = dogsStore.getHistoryVersion;
export const restoreDogsHistoryVersion = dogsStore.restoreHistoryVersion;

/** Sitewide "currently available for reservation" count, computed directly from CMS data (see HomePage.astro for how this replaces facts.json's fact_available_for_reservation marker for the dogs section specifically). */
export function countAvailable(section: DogsSection): number {
  return section.dogs.filter((d) => d.status === 'available').length;
}

// ---------------------------------------------------------------------------
// FAQ section
// ---------------------------------------------------------------------------

export const FAQ_SECTION_PATH = 'cms/sections/faq.json';

export interface FaqItem {
  /** Stable slug (e.g. "faq-q1") — also used to derive the answer's element id for the existing accordion markup. */
  id: string;
  question: LocalizedString;
  answer: LocalizedString;
}

export interface FaqSection extends VersionedSection {
  eyebrow: LocalizedString;
  heading: LocalizedString;
  /** Order in this array = display order */
  items: FaqItem[];
}

const faqStore = createSectionStore<FaqSection>({
  path: FAQ_SECTION_PATH,
  historyPrefix: 'cms/history/faq/',
  seed: faqSeed as FaqSection,
});

export const getFaqSection = faqStore.getSection;
export const saveFaqSection = faqStore.saveSection;
export const listFaqHistory = faqStore.listHistory;
export const getFaqHistoryVersion = faqStore.getHistoryVersion;
export const restoreFaqHistoryVersion = faqStore.restoreHistoryVersion;

// ---------------------------------------------------------------------------
// Testimonials section
// ---------------------------------------------------------------------------

export const TESTIMONIALS_SECTION_PATH = 'cms/sections/testimonials.json';

export type TestimonialStatus = 'pending' | 'approved' | 'rejected';

export interface TestimonialEntry {
  id: string;
  name: string;
  /** Optional, e.g. a country/city the client mentioned — plain string, not localized. */
  location: string | null;
  /** 1-5 */
  rating: number;
  /**
   * The testimonial text exactly as the client wrote it. Deliberately NOT
   * run through src/lib/translate.ts like every other CMS field — that
   * translator is instructed to rephrase naturally rather than literally,
   * which is right for the owner's own marketing copy but wrong here: a
   * testimonial is someone else's direct quote, and rewriting their words
   * (even "naturally") would misrepresent what they actually said. Shown
   * as-is on every locale of the site.
   */
  quote: string;
  submittedAt: string;
  status: TestimonialStatus;
}

export interface TestimonialsSection extends VersionedSection {
  /** Order in this array = display order for approved testimonials */
  items: TestimonialEntry[];
}

const testimonialsStore = createSectionStore<TestimonialsSection>({
  path: TESTIMONIALS_SECTION_PATH,
  historyPrefix: 'cms/history/testimonials/',
  seed: testimonialsSeed as TestimonialsSection,
});

export const getTestimonialsSection = testimonialsStore.getSection;
export const saveTestimonialsSection = testimonialsStore.saveSection;
export const listTestimonialsHistory = testimonialsStore.listHistory;
export const getTestimonialsHistoryVersion = testimonialsStore.getHistoryVersion;
export const restoreTestimonialsHistoryVersion = testimonialsStore.restoreHistoryVersion;

/** Approved testimonials only, in display order — what the public site renders. */
export function approvedTestimonials(section: TestimonialsSection): TestimonialEntry[] {
  return section.items.filter((t) => t.status === 'approved');
}
