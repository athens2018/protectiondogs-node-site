/** Extracted copy still carries legacy Font-Awesome classes (e.g. "fab fa-instagram fa-2x")
    for icon fields. Icon.astro's keys were deliberately named to match the fa- suffix
    (envelope, whatsapp, instagram, lock, clock, ...), so stripping the prefix is enough. */
export function faToIconName(fa: string | null | undefined, fallback = 'envelope'): string {
  if (!fa) return fallback;
  return fa.split(' ').find((c) => c.startsWith('fa-'))?.slice(3) ?? fallback;
}

/** tr/it/pt's floating Instagram icon has no <i> element in the live source
    (a pre-existing site defect, confirmed in scripts/reports/extraction-report.md's
    structural-parity table), so its `icon` field extracts as null. href is a
    reliable fallback signal everywhere the label/aria still came through fine. */
export function iconFromHref(href: string): string {
  if (/instagram\.com/i.test(href)) return 'instagram';
  if (/wa\.me|whatsapp/i.test(href)) return 'whatsapp';
  if (/^tel:/i.test(href)) return 'phone';
  return 'envelope';
}
