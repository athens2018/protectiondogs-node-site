export interface Locale {
  /** Route key, also the key into src/i18n/locales/<code>.json and facts.json formats */
  code: string;
  /** Value for <html lang> and hreflang */
  htmlLang: string;
  dir: 'ltr' | 'rtl';
  /** URL prefix segment ('' for the default locale served at the root) */
  path: string;
  /** Value stored in localStorage 'pdg-lang-pref' by the live site; kept identical so saved preferences survive cutover */
  prefCode: string;
  /** Language name in its own language, as shown in the drawer on every locale */
  nativeName: string;
  /** Short code shown on the language trigger button */
  short: string;
}

export const LOCALES: readonly Locale[] = [
  { code: 'en', htmlLang: 'en', dir: 'ltr', path: '', prefCode: 'en', nativeName: 'English', short: 'EN' },
  { code: 'el', htmlLang: 'el', dir: 'ltr', path: 'el', prefCode: 'el', nativeName: 'Ελληνικά', short: 'EL' },
  { code: 'de', htmlLang: 'de', dir: 'ltr', path: 'de', prefCode: 'de', nativeName: 'Deutsch', short: 'DE' },
  { code: 'fr', htmlLang: 'fr', dir: 'ltr', path: 'fr', prefCode: 'fr', nativeName: 'Français', short: 'FR' },
  { code: 'ar', htmlLang: 'ar', dir: 'rtl', path: 'ar', prefCode: 'ar', nativeName: 'العربية', short: 'AR' },
  { code: 'es', htmlLang: 'es', dir: 'ltr', path: 'es', prefCode: 'es', nativeName: 'Español', short: 'ES' },
  { code: 'zh', htmlLang: 'zh-Hans', dir: 'ltr', path: 'zh', prefCode: 'zh-Hans', nativeName: '中文', short: 'ZH' },
  { code: 'ru', htmlLang: 'ru', dir: 'ltr', path: 'ru', prefCode: 'ru', nativeName: 'Русский', short: 'RU' },
  { code: 'tr', htmlLang: 'tr', dir: 'ltr', path: 'tr', prefCode: 'tr', nativeName: 'Türkçe', short: 'TR' },
  { code: 'it', htmlLang: 'it', dir: 'ltr', path: 'it', prefCode: 'it', nativeName: 'Italiano', short: 'IT' },
  { code: 'pt', htmlLang: 'pt', dir: 'ltr', path: 'pt', prefCode: 'pt', nativeName: 'Português', short: 'PT' },
  { code: 'nl', htmlLang: 'nl', dir: 'ltr', path: 'nl', prefCode: 'nl', nativeName: 'Nederlands', short: 'NL' },
  { code: 'ja', htmlLang: 'ja', dir: 'ltr', path: 'ja', prefCode: 'ja', nativeName: '日本語', short: 'JA' },
] as const;

export type LocaleCode = (typeof LOCALES)[number]['code'];

export const DEFAULT_LOCALE: LocaleCode = 'en';
export const SITE_ORIGIN = 'https://www.protectiondogs.gr';

export function getLocale(code: string | undefined): Locale {
  return LOCALES.find((l) => l.code === code) ?? LOCALES[0];
}

/** Root-relative path for a locale's homepage, always with a trailing slash */
export function localePath(code: string, subpath = ''): string {
  const locale = getLocale(code);
  const prefix = locale.path ? `/${locale.path}/` : '/';
  const clean = subpath.replace(/^\/+/, '');
  return clean ? `${prefix}${clean}${clean.endsWith('/') ? '' : '/'}` : prefix;
}

export function localeUrl(code: string, subpath = ''): string {
  return `${SITE_ORIGIN}${localePath(code, subpath)}`;
}

/** Reciprocal hreflang cluster for a page that exists in every locale, plus x-default → en */
export function hreflangAlternates(subpath = ''): { hreflang: string; href: string }[] {
  const list = LOCALES.map((l) => ({ hreflang: l.htmlLang, href: localeUrl(l.code, subpath) }));
  list.push({ hreflang: 'x-default', href: localeUrl(DEFAULT_LOCALE, subpath) });
  return list;
}

/** Static path params for [lang] routes: every non-default locale */
export function nonDefaultLocaleParams(): { params: { lang: string } }[] {
  return LOCALES.filter((l) => l.code !== DEFAULT_LOCALE).map((l) => ({ params: { lang: l.path } }));
}
