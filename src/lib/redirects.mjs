// Every permanent redirect the live site's .htaccess carried, translated to
// the new clean-URL scheme so each resolves in one hop. Kept as data so the
// same list feeds the build config and can be verified by a script.
const LOCALES = ['el', 'de', 'fr', 'ar', 'es', 'zh', 'ru', 'tr', 'it', 'pt', 'nl', 'ja'];

/** Old physical homepage filenames → clean language paths */
const homepageFiles = {
  '/index.html': '/',
  ...Object.fromEntries(LOCALES.map((l) => [`/index-${l}.html`, `/${l}/`])),
};

/** Privacy policy moved under the locale prefix with a clean URL */
const privacyFiles = {
  '/privacy-policy.html': '/privacy-policy/',
  ...Object.fromEntries(LOCALES.map((l) => [`/privacy-policy-${l}.html`, `/${l}/privacy-policy/`])),
};

/** Group A articles (still indexed) keep their slugs, lose the extension */
const articleFiles = {
  '/breeding-science.html': '/breeding-science/',
  '/training-methodology.html': '/training-methodology/',
  '/comparative-analysis.html': '/comparative-analysis/',
  '/safarimedic-partnership.html': '/safarimedic-partnership/',
};

/** Group B pages retired (already noindex and unlinked): closest equivalent */
const retiredGroupB = {
  '/blog.html': '/',
  '/custom-training.html': '/',
  '/estate-security.html': '/',
  '/nutrition-program.html': '/',
  '/puppy-development.html': '/',
  '/puppy-early-development.html': '/',
};

/** The long-standing retired-page map from .htaccess, re-targeted where the
    old destination has itself moved (articles → clean URL, nutrition → /) */
const legacy = {
  '/about-us.html': '/#about',
  '/advanced-techniques.html': '/training-methodology/',
  '/assessment-process.html': '/#dogs',
  '/breeding-program.html': '/breeding-science/',
  '/client-matching.html': '/#dogs',
  '/consultation.html': '/#contact',
  '/dog-evaluation.html': '/#dogs',
  '/elite-dog-health.html': '/',
  '/emergency-response.html': '/',
  '/estate-handlers.html': '/',
  '/executive-protection.html': '/#about',
  '/executive-training-protocols.html': '/training-methodology/',
  '/handler-training.html': '/training-methodology/',
  '/health-monitoring.html': '/',
  '/luxury-estate-security.html': '/',
  '/medical-preparedness.html': '/safarimedic-partnership/',
  '/performance-maintenance.html': '/',
  '/premium-bloodlines.html': '/breeding-science/',
  '/premium-security-solutions.html': '/',
  '/professional-handling.html': '/training-methodology/',
  '/property-assessment.html': '/',
  '/safari-medic-blog.html': '/safarimedic-partnership/',
  '/security-integration.html': '/training-methodology/',
  '/selection-guide.html': '/#dogs',
  '/strategic-advantage-elite-protection-dogs.html': '/comparative-analysis/',
};

export const REDIRECTS = {
  ...homepageFiles,
  ...privacyFiles,
  ...articleFiles,
  ...retiredGroupB,
  ...legacy,
};
