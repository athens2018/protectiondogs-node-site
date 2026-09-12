// Adapts the CMS's DogsSection (src/lib/cms.ts) into the exact prop shapes
// src/components/sections/Dogs.astro and BoboStoryModal.astro already
// expect. This is a data-source swap, not a component rewrite: neither
// component's Props interface changes.
//
// Dogs.astro's layout is hardcoded to exactly one "bobo"-style card (a
// photo + full bio + reservation) and exactly one "future"-style card (a
// placeholder + short paragraph). The CMS's `dogs` array is intentionally
// more general (ready for more than two entries later), so this adapter
// picks the first 'available' entry for the bobo slot and the first
// 'future' entry for the future slot — today that's exactly "bobo" and
// "future-availability", so the rendered output is unchanged. If the owner
// ever removes every 'available' or every 'future' entry, this falls back
// to the checked-in seed entry for that slot rather than crashing the
// build (same fail-soft convention as facts-merge.ts and instagram-store.ts).
import dogsSeed from '../data/dogs-seed.json';
import { resolveLocaleString, type DogEntry, type DogsSection } from './cms';

const seed = dogsSeed as DogsSection;
const seedBobo = seed.dogs.find((d) => d.status === 'available')!;
const seedFuture = seed.dogs.find((d) => d.status === 'future')!;

const MEET_BUTTON_ICON = 'fas fa-paw me-2';

function pickAvailable(section: DogsSection): DogEntry {
  return section.dogs.find((d) => d.status === 'available') ?? seedBobo;
}

function pickFuture(section: DogsSection): DogEntry {
  return section.dogs.find((d) => d.status === 'future') ?? seedFuture;
}

interface DogsChrome {
  eyebrow: string;
  h2: string;
  /** Raw HTML, still carries the facts-merge marker/count — unchanged, see cms.ts's countAvailable() comment */
  availability: string;
  intro: string;
}

/** Builds the exact Props object Dogs.astro's `Astro.props` destructures. */
export function toDogsProps(section: DogsSection, locale: string, chrome: DogsChrome) {
  const bobo = pickAvailable(section);
  const future = pickFuture(section);
  const L = (f: DogEntry['name']) => resolveLocaleString(f, locale);
  const storyOpen = `${bobo.id}-story-modal`;

  return {
    eyebrow: chrome.eyebrow,
    h2: chrome.h2,
    availability: chrome.availability,
    intro: chrome.intro,
    bobo: {
      storyOpen,
      image: bobo.photo
        ? { src: bobo.photo.src, alt: L(bobo.photo.alt) }
        : { src: '', alt: L(bobo.name) },
      name: L(bobo.name),
      tagline: L(bobo.tagline),
      stats: bobo.stats.map((s) => ({ label: L(s.label), value: L(s.value) })),
      meetButton: {
        label: L(bobo.meetButtonLabel ?? bobo.name),
        icon: MEET_BUTTON_ICON,
        data: { 'data-story-open': storyOpen },
      },
      paragraphs: bobo.paragraphs.map(L),
      aboutHeading: L(bobo.aboutHeading ?? bobo.name),
      features: bobo.features.map(L),
      reservation: bobo.reservation
        ? {
            eyebrow: L(bobo.reservation.eyebrow),
            price: { currency: bobo.reservation.priceCurrency, amount: L(bobo.reservation.priceAmount) },
            notes: bobo.reservation.notes.map(L),
            cta: {
              label: L(bobo.reservation.ctaLabel),
              href: '#contact',
              data: { 'data-interest': bobo.reservation.ctaInterest, 'data-stop-propagation': '' },
            },
          }
        : {
            // Should never happen for the 'available' slot in practice (the
            // admin form requires a reservation block for 'available'
            // status), but keeps this function total rather than throwing.
            eyebrow: '',
            price: { currency: '', amount: '' },
            notes: [],
            cta: { label: '', href: '#contact', data: { 'data-interest': 'General Enquiry', 'data-stop-propagation': '' } },
          },
    },
    future: {
      name: L(future.name),
      tagline: L(future.tagline),
      stats: future.stats.map((s) => ({ label: L(s.label), value: L(s.value) })),
      paragraph: L(future.paragraphs[0]),
      cta: future.futureCta
        ? { label: L(future.futureCta.label), href: future.futureCta.href, data: { 'data-interest': future.futureCta.interest } }
        : { label: '', href: '#contact', data: { 'data-interest': 'Future Litter' } },
    },
  };
}

interface StoryChrome {
  ariaLabelledby: string;
  close: { label: string; ariaLabel: string };
  media: { image: { src: string; alt: string }; video: { ariaLabel: string; poster: string; src: string } };
  nav: { prev: string; next: string; jsClose: string; jsNext: string };
}

/**
 * Builds BoboStoryModal.astro's Props (minus `id`, which HomePage.astro
 * already derives from dogs.bobo.storyOpen). Returns null if the current
 * "available" dog has no story — HomePage.astro should skip rendering the
 * modal entirely in that case.
 */
export function toStoryModalProps(section: DogsSection, locale: string, chrome: StoryChrome) {
  const bobo = pickAvailable(section);
  if (!bobo.story) return null;
  const L = (f: DogEntry['name']) => resolveLocaleString(f, locale);

  return {
    ariaLabelledby: chrome.ariaLabelledby,
    close: chrome.close,
    media: chrome.media,
    title: L(bobo.story.title),
    // Computed from the actual slide count rather than trusted from the
    // locale JSON's static `dotCount`, so a story with a different number
    // of slides (2-6 per the CMS data model) than today's 4 still renders
    // the right number of dots.
    dotCount: bobo.story.slides.length,
    slides: bobo.story.slides.map((slide, i) => ({
      slide: String(i),
      image: slide.image,
      video: slide.video,
      h4: L(slide.heading),
      p: L(slide.body),
    })),
    nav: chrome.nav,
  };
}
