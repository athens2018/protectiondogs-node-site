// Adapts the CMS's FaqSection (src/lib/cms.ts) into the exact prop shape
// src/components/sections/Faq.astro already expects, plus the FAQPage
// JSON-LD block HomePage.astro injects into <head>. Before this, that
// JSON-LD was a third, separately-authored static copy of the same
// question/answer text (per-locale meta.jsonld.faqpage in
// src/i18n/locales/*.json) that had to be kept in sync by hand — now both
// come from the one CMS-authored copy.
import { resolveLocaleString, type FaqSection } from './cms';

/** Builds Faq.astro's Props from the CMS FaqSection. */
export function toFaqProps(section: FaqSection, locale: string) {
  const L = (f: Parameters<typeof resolveLocaleString>[0]) => resolveLocaleString(f, locale);
  return {
    eyebrow: L(section.eyebrow),
    h2: L(section.heading),
    items: section.items.map((item) => ({
      id: item.id,
      answerId: item.id.replace(/^faq-q/, 'faq-a'),
      question: L(item.question),
      answer: L(item.answer),
    })),
  };
}

/** Builds the FAQPage JSON-LD block for HomePage.astro's <head> fragment. */
export function toFaqJsonLd(section: FaqSection, locale: string) {
  const L = (f: Parameters<typeof resolveLocaleString>[0]) => resolveLocaleString(f, locale);
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: section.items.map((item) => ({
      '@type': 'Question',
      name: L(item.question),
      acceptedAnswer: { '@type': 'Answer', text: L(item.answer) },
    })),
  };
}
