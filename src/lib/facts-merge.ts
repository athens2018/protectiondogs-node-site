import facts from '../data/facts.json';

type AnyRecord = Record<string, any>;

function warn(message: string): void {
  // Never throws — a content-shape drift here should degrade to "left
  // unchanged" for that one field, not break the whole page build.
  // eslint-disable-next-line no-console
  console.warn(`[facts-merge] ${message}`);
}

/**
 * Locate an exact `<!--pdg:KEY-->...<!--/pdg-->` marker span inside `html`
 * (the convention used throughout src/i18n/locales/*.json — see
 * scripts/reports/extraction-report.md section E) and replace only the
 * captured value between the comments with `newValue`. The surrounding
 * sentence/markup is left byte-for-byte untouched.
 *
 * Never throws: if `html` isn't a string, or the marker isn't found, the
 * original value is returned unchanged and a warning is logged instead —
 * per the task brief, a missing marker should fail soft, not fail the build.
 */
function replaceMarker(html: unknown, markerKey: string, newValue: string, pathLabel: string): unknown {
  if (typeof html !== 'string') {
    warn(`expected a string at "${pathLabel}" to patch marker "${markerKey}", got ${typeof html}; left unchanged`);
    return html;
  }
  const re = new RegExp(`(<!--pdg:${markerKey}-->)([\\s\\S]*?)(<!--/pdg-->)`);
  if (!re.test(html)) {
    warn(`marker "${markerKey}" not found at "${pathLabel}"; left unchanged`);
    return html;
  }
  return html.replace(re, `$1${newValue}$3`);
}

/**
 * Deep-clones `content` (one locale's homepage JSON, e.g. src/i18n/locales/en.json)
 * and overwrites the managed-fact marker spans with values derived from
 * src/data/facts.json, formatted for `localeCode` via facts.formats[localeCode].
 *
 * Every path patched below is listed with "_managed": true in
 * scripts/reports/extraction-report.md's "Managed keys" table, cross-checked
 * against every one of the 13 locales (they all use the same JSON paths):
 *
 *   fact_available_for_reservation → dogs.availability
 *   stage_display                  → dogs.bobo.tagline
 *   dob_display                    → dogs.bobo.stats[0].value   (stats[0].label === "Born")
 *   status_display                 → dogs.bobo.stats[2].value   (stats[2].label === "Status")
 *   price_current                  → dogs.bobo.reservation.price.amount
 *   next_litter_label              → dogs.future.stats[0].label
 *   next_litter                    → dogs.future.stats[0].value
 *   price_future                   → pricing.cards[0].price.amount
 *
 * dogs.bobo.reservation.notes[0] is DELIBERATELY excluded — see the comment
 * at its call site below.
 */
export function mergeFacts(localeCode: string, content: any): any {
  const clone: AnyRecord = JSON.parse(JSON.stringify(content));
  const allFormats = (facts as AnyRecord).formats as AnyRecord;
  const format: AnyRecord | undefined = allFormats[localeCode];
  const f = (facts as AnyRecord).facts as AnyRecord;

  if (!format) {
    warn(`no facts.formats entry for locale "${localeCode}"; skipping all managed-fact substitutions`);
    return clone;
  }

  // dogs.availability — a sentence with one inline boolean marker.
  // facts.json stores a real boolean; the extracted HTML used "1"/"0" text
  // (see extraction-report.md section E note), so that convention is kept.
  if (clone.dogs && typeof clone.dogs.availability !== 'undefined') {
    clone.dogs.availability = replaceMarker(
      clone.dogs.availability,
      'fact_available_for_reservation',
      f.available_for_reservation ? '1' : '0',
      'dogs.availability',
    );
  } else {
    warn('path "dogs.availability" not found; skipping');
  }

  // dogs.bobo.tagline ← stage_display
  if (clone.dogs?.bobo && typeof clone.dogs.bobo.tagline !== 'undefined') {
    clone.dogs.bobo.tagline = replaceMarker(
      clone.dogs.bobo.tagline,
      'stage_display',
      format.stage_display,
      'dogs.bobo.tagline',
    );
  } else {
    warn('path "dogs.bobo.tagline" not found; skipping');
  }

  // dogs.bobo.stats[0].value ← dob_display (stats[0].label is "Born")
  const boboStat0 = clone.dogs?.bobo?.stats?.[0];
  if (boboStat0 && typeof boboStat0.value !== 'undefined') {
    boboStat0.value = replaceMarker(boboStat0.value, 'dob_display', format.dob_display, 'dogs.bobo.stats[0].value');
  } else {
    warn('path "dogs.bobo.stats[0].value" not found; skipping');
  }

  // dogs.bobo.stats[2].value ← status_display (stats[2].label is "Status")
  const boboStat2 = clone.dogs?.bobo?.stats?.[2];
  if (boboStat2 && typeof boboStat2.value !== 'undefined') {
    boboStat2.value = replaceMarker(
      boboStat2.value,
      'status_display',
      format.status_display,
      'dogs.bobo.stats[2].value',
    );
  } else {
    warn('path "dogs.bobo.stats[2].value" not found; skipping');
  }

  // dogs.bobo.reservation.price.amount ← price_current
  const boboPrice = clone.dogs?.bobo?.reservation?.price;
  if (boboPrice && typeof boboPrice.amount !== 'undefined') {
    boboPrice.amount = replaceMarker(
      boboPrice.amount,
      'price_current',
      format.price_current,
      'dogs.bobo.reservation.price.amount',
    );
  } else {
    warn('path "dogs.bobo.reservation.price.amount" not found; skipping');
  }

  // dogs.bobo.reservation.notes[0] is DELIBERATELY NOT patched, even though
  // extraction-report.md's "Managed keys" table lists it as embedding a
  // price_future marker too ("Bobo is the last dog at this price point.
  // Pricing moves to €<!--pdg:price_future-->70,000<!--/pdg--> starting with
  // the next litter."). Unlike the fields above, this is a fully authored,
  // grammatical sentence in each of the 13 languages — the number sits
  // inside word order, agreement and punctuation that a regex can't safely
  // re-verify. It's already confirmed correct for the current facts.json
  // (extraction-report.md section E: 100% "ok" for price_future at this
  // path across every locale), so it's intentionally left exactly as
  // extracted. If facts.future_price ever changes, this sentence needs a
  // human/translator pass, not an automated substitution here.

  // dogs.future.stats[0] ← next_litter_label / next_litter
  const futureStat0 = clone.dogs?.future?.stats?.[0];
  if (futureStat0) {
    if (typeof futureStat0.label !== 'undefined') {
      futureStat0.label = replaceMarker(
        futureStat0.label,
        'next_litter_label',
        format.next_litter_label,
        'dogs.future.stats[0].label',
      );
    } else {
      warn('path "dogs.future.stats[0].label" not found; skipping');
    }
    if (typeof futureStat0.value !== 'undefined') {
      futureStat0.value = replaceMarker(
        futureStat0.value,
        'next_litter',
        format.next_litter,
        'dogs.future.stats[0].value',
      );
    } else {
      warn('path "dogs.future.stats[0].value" not found; skipping');
    }
  } else {
    warn('path "dogs.future.stats[0]" not found; skipping');
  }

  // pricing.cards[0].price.amount ← price_future
  const pricingPrice = clone.pricing?.cards?.[0]?.price;
  if (pricingPrice && typeof pricingPrice.amount !== 'undefined') {
    pricingPrice.amount = replaceMarker(
      pricingPrice.amount,
      'price_future',
      format.price_future,
      'pricing.cards[0].price.amount',
    );
  } else {
    warn('path "pricing.cards[0].price.amount" not found; skipping');
  }

  return clone;
}
