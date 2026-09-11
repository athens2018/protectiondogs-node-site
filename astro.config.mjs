// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import sitemap from '@astrojs/sitemap';
import { REDIRECTS } from './src/lib/redirects.mjs';
import { inlineScriptHashes } from './src/lib/inline-scripts.mjs';

const LOCALE_CODES = ['en', 'el', 'de', 'fr', 'ar', 'es', 'zh', 'ru', 'tr', 'it', 'pt', 'nl', 'ja'];

export default defineConfig({
  site: 'https://www.protectiondogs.gr',
  trailingSlash: 'always',
  output: 'static',
  adapter: vercel({ staticHeaders: true }),
  redirects: REDIRECTS,
  i18n: {
    defaultLocale: 'en',
    locales: LOCALE_CODES,
    routing: { prefixDefaultLocale: false },
  },
  security: {
    // Enforced CSP, emitted as a response header by the Vercel adapter (and
    // mirrored as a <meta> tag). Astro hashes the inline scripts and styles
    // it emits; the three hand-written inline scripts are hashed from the
    // same source they are rendered from (src/lib/inline-scripts.mjs).
    csp: {
      algorithm: 'SHA-256',
      directives: [
        "default-src 'self'",
        "font-src 'self' data:",
        "img-src 'self' data: https:",
        "media-src 'self'",
        'frame-src https://testimonial.to https://embed-v2.testimonial.to https://www.instagram.com',
        "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com https://analytics.google.com https://stats.g.doubleclick.net https://embed-v2.testimonial.to https://testimonial.to",
        "worker-src 'self'",
        "manifest-src 'self'",
        "form-action 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'self'",
        'upgrade-insecure-requests',
      ],
      styleDirective: {
        resources: ["'self'", "'unsafe-inline'"],
      },
      scriptDirective: {
        resources: ["'self'", 'https://testimonial.to', 'https://embed-v2.testimonial.to', 'https://www.googletagmanager.com'],
        // inlineScriptHashes() returns plain `sha256-…` strings, exactly the
        // shape Astro's own CspHashEntry accepts at runtime (verified in a
        // real build: the hashes show up correctly in the generated CSP
        // header) — zod's `.custom()` validator just doesn't expose a static
        // type that structurally equals `string` for `// @ts-check` to see.
        hashes: /** @type {any} */ (inlineScriptHashes()),
      },
    },
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
