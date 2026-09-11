// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import sitemap from '@astrojs/sitemap';

const LOCALE_CODES = ['en', 'el', 'de', 'fr', 'ar', 'es', 'zh', 'ru', 'tr', 'it', 'pt', 'nl', 'ja'];

export default defineConfig({
  site: 'https://www.protectiondogs.gr',
  trailingSlash: 'always',
  output: 'static',
  adapter: vercel(),
  i18n: {
    defaultLocale: 'en',
    locales: LOCALE_CODES,
    routing: { prefixDefaultLocale: false },
  },
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: 'en',
        locales: {
          en: 'en',
          el: 'el',
          de: 'de',
          fr: 'fr',
          ar: 'ar',
          es: 'es',
          zh: 'zh-Hans',
          ru: 'ru',
          tr: 'tr',
          it: 'it',
          pt: 'pt',
          nl: 'nl',
          ja: 'ja',
        },
      },
    }),
  ],
});
