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
  // maxDuration: the Dogs CMS save route (src/pages/admin/api/dogs/save.ts)
  // returns to the admin immediately, then keeps working in the background
  // via @vercel/functions' waitUntil — translating into the other 12
  // locales, redeploying, waiting out a fixed settle delay, then emailing
  // the owner that the update is live. 150s gives that whole chain room to
  // finish; Vercel's Hobby plan (with fluid compute, the default) allows up
  // to 300s, so this is a safe ceiling rather than a number expected to be hit.
  adapter: vercel({ staticHeaders: true, maxDuration: 150 }),
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
        // 'self' covered every video before the Dogs CMS: today's assets
        // all sit under /images (public/). The CMS's new public Blob
        // store (see src/lib/cms.ts, src/pages/admin/api/upload.ts) puts
        // owner-uploaded story-modal videos on Vercel's own Blob CDN
        // domain instead, so media-src needs that host too — scoped to
        // Vercel's public-blob domain suffix specifically, not a bare
        // https: wildcard (img-src already allows that broadly; video
        // doesn't need to).
        "media-src 'self' https://*.public.blob.vercel-storage.com",
        'frame-src https://www.instagram.com',
        "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com https://analytics.google.com https://stats.g.doubleclick.net",
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
        resources: ["'self'", 'https://www.googletagmanager.com'],
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
      // The admin/CMS panel (src/pages/admin/**) is all SSR-only
      // (prerender = false), but @astrojs/sitemap still enumerates it from
      // the route manifest regardless of render mode — without this
      // filter it was leaking /admin/login/, /admin/dogs/, etc. into the
      // public sitemap.xml. Those routes already carry a `noindex,
      // nofollow` meta tag and sit behind requireAdmin's real auth check,
      // so this is defense in depth, not the only protection.
      filter: (page) => !new URL(page).pathname.startsWith('/admin'),
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
