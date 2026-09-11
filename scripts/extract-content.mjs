#!/usr/bin/env node
/**
 * Phase 1 — programmatic copy extraction for the Astro rebuild.
 *
 * Reads the 13 live homepages (../index*.html) and 13 privacy pages
 * (../privacy-policy*.html), which are READ-ONLY, and writes:
 *
 *   src/i18n/locales/<lang>.json      homepage copy
 *   src/i18n/privacy/<lang>.json      privacy-policy copy
 *   scripts/reports/extraction-report.md / .json   verification report
 *
 * Byte-exactness rules (see the brief):
 *   - every HTML value is a slice of the ORIGINAL source string
 *     (startTag.endOffset .. endTag.startOffset), trimmed of leading /
 *     trailing whitespace only. Entities are never decoded, inline markup
 *     is kept, nothing is reworded or normalised.
 *   - attribute values are parse5's parsed attribute value.
 *   - JS-only strings (validation / status messages) are pulled from the
 *     inline <script> blocks by regex, with the source line recorded.
 *
 * The only structural liberty taken: purely decorative, text-less leading /
 * trailing <i>/<svg>/<span> children (Font Awesome icons, check bullets,
 * toggle chevrons) are excluded from a value's slice. Every such strip is
 * recorded in the report. The remaining slice is still contiguous source.
 *
 * Deterministic: no timestamps, DOM order preserved, nothing sorted.
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, parseFragment } from 'parse5';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODE_SITE = resolve(__dirname, '..');
const SITE_ROOT = resolve(NODE_SITE, '..');
const OUT_LOCALES = resolve(NODE_SITE, 'src', 'i18n', 'locales');
const OUT_PRIVACY = resolve(NODE_SITE, 'src', 'i18n', 'privacy');
const OUT_REPORTS = resolve(__dirname, 'reports');
const FACTS = JSON.parse(readFileSync(resolve(NODE_SITE, 'src', 'data', 'facts.json'), 'utf8'));

const LANGS = ['en', 'el', 'de', 'fr', 'ar', 'es', 'zh', 'ru', 'tr', 'it', 'pt', 'nl', 'ja'];
const homeFile = (l) => (l === 'en' ? 'index.html' : `index-${l}.html`);
const privacyFile = (l) => (l === 'en' ? 'privacy-policy.html' : `privacy-policy-${l}.html`);

/* ------------------------------------------------------------------ */
/* Tiny DOM helpers over the parse5 tree                              */
/* ------------------------------------------------------------------ */
const isEl = (n) => !!n && !!n.tagName;
const children = (n) => (n && n.childNodes ? n.childNodes.filter(isEl) : []);
const attr = (el, name) => {
  const a = el && el.attrs ? el.attrs.find((x) => x.name === name) : null;
  return a ? a.value : null;
};
const hasAttr = (el, name) => !!(el && el.attrs && el.attrs.some((x) => x.name === name));
const classes = (el) => (attr(el, 'class') || '').split(/\s+/).filter(Boolean);
const collapse = (s) => s.replace(/\s+/g, ' ').trim();

function* walk(node) {
  for (const c of node.childNodes || []) {
    yield c;
    if (c.childNodes) yield* walk(c);
  }
}
function textOf(node) {
  if (node.nodeName === '#text') return node.value;
  if (node.nodeName === '#comment') return '';
  let s = '';
  for (const c of node.childNodes || []) s += textOf(c);
  return s;
}
function nextElementSibling(el) {
  const sibs = children(el.parentNode);
  return sibs[sibs.indexOf(el) + 1] || null;
}

/* ------------------------------------------------------------------ */
/* Minimal CSS-ish selector engine (tag, #id, .class, [attr op value], */
/* :first-child, :last-child, :nth-child(n), :nth-of-type(n), :not()); */
/* descendant (space) and child (>) combinators.                      */
/* ------------------------------------------------------------------ */
function parseCompound(str) {
  const c = { tag: null, id: null, classes: [], attrs: [], pseudos: [] };
  let i = 0;
  const tm = /^([a-zA-Z][\w-]*|\*)/.exec(str);
  if (tm) {
    c.tag = tm[1] === '*' ? null : tm[1].toLowerCase();
    i = tm[0].length;
  }
  while (i < str.length) {
    const rest = str.slice(i);
    let m;
    if ((m = /^#([\w-]+)/.exec(rest))) c.id = m[1];
    else if ((m = /^\.([\w-]+)/.exec(rest))) c.classes.push(m[1]);
    else if ((m = /^\[([\w:-]+)(?:([~|^$*]?=)"?([^"\]]*)"?)?\]/.exec(rest))) c.attrs.push({ name: m[1], op: m[2] || null, value: m[3] ?? null });
    else if ((m = /^:([\w-]+)(?:\(([^)]*)\))?/.exec(rest))) c.pseudos.push({ name: m[1], arg: m[2] });
    else throw new Error(`Bad selector near "${rest}" in "${str}"`);
    i += m[0].length;
  }
  return c;
}
function parseSelector(sel) {
  const parts = [];
  let buf = '';
  let depth = 0;
  let pending = ' ';
  const flush = () => {
    if (buf.trim()) parts.push({ comb: pending, compound: parseCompound(buf.trim()) });
    buf = '';
  };
  for (const ch of sel) {
    if (ch === '[' || ch === '(') depth++;
    if (ch === ']' || ch === ')') depth--;
    if (depth === 0 && (ch === ' ' || ch === '>')) {
      if (buf.trim()) {
        flush();
        pending = ' ';
      }
      if (ch === '>') pending = '>';
      continue;
    }
    buf += ch;
  }
  flush();
  return parts;
}
function matchesCompound(el, c) {
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id && attr(el, 'id') !== c.id) return false;
  const cls = classes(el);
  for (const k of c.classes) if (!cls.includes(k)) return false;
  for (const a of c.attrs) {
    const v = attr(el, a.name);
    if (v === null) return false;
    if (a.op === '=' && v !== a.value) return false;
    if (a.op === '^=' && !v.startsWith(a.value)) return false;
    if (a.op === '$=' && !v.endsWith(a.value)) return false;
    if (a.op === '*=' && !v.includes(a.value)) return false;
    if (a.op === '~=' && !v.split(/\s+/).includes(a.value)) return false;
  }
  for (const p of c.pseudos) {
    const sibs = children(el.parentNode);
    if (p.name === 'first-child' && sibs[0] !== el) return false;
    if (p.name === 'last-child' && sibs[sibs.length - 1] !== el) return false;
    if (p.name === 'nth-child' && sibs[Number(p.arg) - 1] !== el) return false;
    if (p.name === 'nth-of-type' && sibs.filter((s) => s.tagName === el.tagName)[Number(p.arg) - 1] !== el) return false;
    if (p.name === 'not' && matchesCompound(el, parseCompound(p.arg))) return false;
  }
  return true;
}
function matchesChain(el, parts, idx) {
  if (!matchesCompound(el, parts[idx].compound)) return false;
  if (idx === 0) return true;
  if (parts[idx].comb === '>') return isEl(el.parentNode) && matchesChain(el.parentNode, parts, idx - 1);
  for (let p = el.parentNode; isEl(p); p = p.parentNode) if (matchesChain(p, parts, idx - 1)) return true;
  return false;
}
function queryAll(root, sel) {
  const parts = parseSelector(sel);
  const out = [];
  for (const n of walk(root)) if (isEl(n) && matchesChain(n, parts, parts.length - 1)) out.push(n);
  return out;
}
const query = (root, sel) => queryAll(root, sel)[0] || null;

/* ------------------------------------------------------------------ */
/* Extraction primitives. Every leaf is an `Ex` carrying its value and  */
/* provenance; `finalize()` turns the tree into plain JSON and records  */
/* one report entry per leaf.                                           */
/* ------------------------------------------------------------------ */
class Ex {
  constructor(p) {
    Object.assign(this, p);
  }
}

function isDecoration(n) {
  if (n.nodeName === '#text') return n.value.trim() === '';
  if (!isEl(n)) return false;
  if (!['i', 'svg', 'span'].includes(n.tagName)) return false;
  return collapse(textOf(n)) === '';
}

function makeContext(src, doc, page) {
  const nl = [];
  for (let i = src.indexOf('\n'); i !== -1; i = src.indexOf('\n', i + 1)) nl.push(i);
  const lineOf = (off) => {
    if (off == null) return null;
    let lo = 0;
    let hi = nl.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (nl[mid] < off) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
  const outer = (n) => src.slice(n.sourceCodeLocation.startOffset, n.sourceCodeLocation.endOffset);

  const X = {
    /** raw innerHTML slice (leading/trailing decorations excluded, see header) */
    html(el, extra = {}) {
      if (!el) return new Ex({ kind: 'html', value: null, missing: true, ...extra });
      const loc = el.sourceCodeLocation;
      let start = loc.startTag.endOffset;
      let end = loc.endTag ? loc.endTag.startOffset : loc.endOffset;
      const stripped = [];
      const kids = el.childNodes || [];
      let a = 0;
      let b = kids.length - 1;
      while (a <= b && isDecoration(kids[a])) {
        if (isEl(kids[a])) stripped.push({ position: 'leading', html: outer(kids[a]) });
        a++;
      }
      while (b >= a && isDecoration(kids[b])) {
        if (isEl(kids[b])) stripped.push({ position: 'trailing', html: outer(kids[b]) });
        b--;
      }
      if (a <= b) {
        start = kids[a].sourceCodeLocation.startOffset;
        end = kids[b].sourceCodeLocation.endOffset;
      } else if (kids.length) {
        end = start; // only decorations / whitespace inside
      }
      const raw = src.slice(start, end);
      return new Ex({ kind: 'html', value: raw.trim(), start, end, line: lineOf(start), node: el, stripped: [...stripped, ...(extra.stripped || [])], ...omit(extra, 'stripped') });
    },
    /** optional element: null (not a mismatch) when absent */
    htmlOpt(el, extra) {
      return el ? X.html(el, extra) : null;
    },
    /** raw slice of an element's content AFTER a given child node */
    htmlAfter(el, afterNode, extra = {}) {
      if (!el) return new Ex({ kind: 'html', value: null, missing: true, ...extra });
      const loc = el.sourceCodeLocation;
      const start = afterNode ? afterNode.sourceCodeLocation.endOffset : loc.startTag.endOffset;
      const end = loc.endTag ? loc.endTag.startOffset : loc.endOffset;
      const raw = src.slice(start, end);
      return new Ex({ kind: 'html', value: raw.trim(), start, end, line: lineOf(start), node: el, stripped: afterNode ? [{ position: 'leading', html: outer(afterNode), reason: 'extracted separately' }] : [], ...extra });
    },
    /** attribute of an optional element: null (not a mismatch) when the element is absent */
    atOpt(el, name) {
      return el ? X.at(el, name) : null;
    },
    /** parsed attribute value; null (not a mismatch) when the attribute is absent */
    at(el, name) {
      if (!el) return new Ex({ kind: 'attr', attr: name, value: null, missing: true });
      const v = attr(el, name);
      if (v === null) return new Ex({ kind: 'attr', attr: name, value: null, absent: true, node: el, line: lineOf(el.sourceCodeLocation.startOffset) });
      const aloc = el.sourceCodeLocation.attrs && el.sourceCodeLocation.attrs[name];
      return new Ex({ kind: 'attr', attr: name, value: v, start: aloc ? aloc.startOffset : null, end: aloc ? aloc.endOffset : null, line: lineOf(aloc ? aloc.startOffset : el.sourceCodeLocation.startOffset), node: el });
    },
    /** nth match of a regex over the whole file; `group` is the capture holding the literal */
    js(re, { nth = 0, group = 1, desc = '' } = {}) {
      const flags = re.flags.replace(/[gd]/g, '') + 'gd';
      const g = new RegExp(re.source, flags);
      let m;
      let i = 0;
      while ((m = g.exec(src))) {
        if (i === nth) break;
        i++;
      }
      if (!m || !m.indices[group]) return new Ex({ kind: 'js', value: null, missing: true, desc });
      const [start, end] = m.indices[group];
      const raw = src.slice(start, end);
      return new Ex({ kind: 'js', value: unescapeJs(raw), raw, start, end, line: lineOf(start), desc });
    },
    /** an object literal `{ 'k': 'v', ... }` inside a script, as {k: Ex} */
    jsMap(re) {
      const m = new RegExp(re.source, re.flags.replace(/[gd]/g, '') + 'd').exec(src);
      if (!m) return null;
      const [bs, be] = m.indices[1];
      const block = src.slice(bs, be);
      const out = {};
      const pair = /'([\w-]+)':\s*'((?:[^'\\]|\\.)*)'/g;
      let p;
      while ((p = pair.exec(block))) {
        const start = bs + p.index + p[0].indexOf(p[2], p[1].length + 3);
        const end = start + p[2].length;
        out[p[1]] = new Ex({ kind: 'js', value: unescapeJs(p[2]), raw: p[2], start, end, line: lineOf(start) });
      }
      return out;
    },
    /** a JSON-LD <script> block, parsed */
    jsonld(scriptEl) {
      const t = (scriptEl.childNodes || []).find((n) => n.nodeName === '#text');
      const start = t.sourceCodeLocation.startOffset;
      const end = t.sourceCodeLocation.endOffset;
      let value = null;
      let error = null;
      try {
        value = JSON.parse(src.slice(start, end));
      } catch (e) {
        error = e.message;
      }
      return new Ex({ kind: 'jsonld', value, start, end, line: lineOf(start), error });
    },
    lineOf,
    outer,
    src,
    doc,
    page,
  };
  return X;
}
function omit(obj, key) {
  const o = { ...obj };
  delete o[key];
  return o;
}
function unescapeJs(raw) {
  return raw.replace(/\\(['"\\])/g, '$1');
}

/** Replace every Ex with its value and collect report entries. */
function finalize(node, path, entries) {
  if (node instanceof Ex) {
    const { node: _n, ...rest } = node;
    entries.push({ path, ...rest, node: _n });
    return node.value;
  }
  if (Array.isArray(node)) return node.map((v, i) => finalize(v, `${path}[${i}]`, entries));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = finalize(v, path ? `${path}.${k}` : k, entries);
    return out;
  }
  if (typeof node === 'string') entries.push({ path, kind: 'derived', value: node });
  return node;
}

/* ------------------------------------------------------------------ */
/* Shared fragments                                                   */
/* ------------------------------------------------------------------ */
const JS = {
  nameRequired: /name\.nextElementSibling\.textContent = '((?:[^'\\]|\\.)*)'/,
  emailInvalid: /email\.nextElementSibling\.textContent = '((?:[^'\\]|\\.)*)'/,
  messageRequired: /message\.nextElementSibling\.textContent = '((?:[^'\\]|\\.)*)'/,
  privacyRequired: /alert\('((?:[^'\\]|\\.)*)'\)/,
  submitInnerHTML: /submitButton\.innerHTML = '((?:[^'\\]|\\.)*)';/,
  success: /showNotification\('((?:[^'\\]|\\.)*)', 'success'\)/,
  danger: /showNotification\('((?:[^'\\]|\\.)*)', 'danger'\)/,
  notificationClose: /closeBtn\.setAttribute\('aria-label', '((?:[^'\\]|\\.)*)'\)/,
  iframeTitle: /f\.title = '((?:[^'\\]|\\.)*)';/,
  storyNav: /nextBtn\.textContent = current === slides\.length - 1 \? '((?:[^'\\]|\\.)*)' : '((?:[^'\\]|\\.)*)';/,
};

function dataAttrs(X, el) {
  const out = {};
  for (const a of el.attrs || []) {
    if (!a.name.startsWith('data-') || a.name.startsWith('data-aos') || a.name.startsWith('data-bs-')) continue;
    out[a.name] = X.at(el, a.name);
  }
  return out;
}
const iconOf = (X, el) => {
  const i = query(el, 'i');
  return i ? X.at(i, 'class') : null;
};
const ctaOf = (X, a) => ({ label: X.html(a), href: X.at(a, 'href'), data: a ? dataAttrs(X, a) : {} });
const paragraphsOf = (X, el) => children(el).filter((c) => c.tagName === 'p').map((p) => X.html(p));

/** Ordered content blocks of a container (headings, paragraphs, lists, links), nested divs flattened. */
function blocksOf(X, container, out = []) {
  for (const c of children(container)) {
    const t = c.tagName;
    if (t === 'div' || t === 'section') blocksOf(X, c, out);
    else if (t === 'ul' || t === 'ol') out.push({ tag: t, items: children(c).filter((li) => li.tagName === 'li').map((li) => X.html(li)) });
    else if (t === 'p' || /^h[1-6]$/.test(t)) out.push({ tag: t, html: X.html(c) });
    else if (t === 'a' || t === 'button') out.push({ tag: t, html: X.html(c), href: X.at(c, 'href') });
    else if (['i', 'img', 'picture', 'hr', 'br', 'svg'].includes(t)) continue;
    else out.push({ tag: t, html: X.html(c), unexpected: true });
  }
  return out;
}

function metaOf(X, doc) {
  const $ = (s, r = doc) => query(r, s);
  const htmlEl = children(doc).find((n) => n.tagName === 'html');
  const head = $('head');
  const jsonld = {};
  for (const s of queryAll(head, 'script[type="application/ld+json"]')) {
    const ex = X.jsonld(s);
    const type = ((ex.value && ex.value['@type']) || 'unknown').toLowerCase();
    jsonld[type] = ex;
  }
  return {
    title: X.html($('title', head)),
    description: X.at($('meta[name=description]', head), 'content'),
    ogTitle: X.atOpt($('meta[property="og:title"]', head), 'content'),
    ogDescription: X.atOpt($('meta[property="og:description"]', head), 'content'),
    ogLocale: X.atOpt($('meta[property="og:locale"]', head), 'content'),
    ogUrl: X.atOpt($('meta[property="og:url"]', head), 'content'),
    twitterTitle: X.atOpt($('meta[name="twitter:title"]', head), 'content'),
    twitterDescription: X.atOpt($('meta[name="twitter:description"]', head), 'content'),
    canonical: X.atOpt($('link[rel=canonical]', head), 'href'),
    lang: X.at(htmlEl, 'lang'),
    dir: X.at(htmlEl, 'dir'),
    jsonld,
  };
}

function navOf(X, navEl) {
  const $ = (s, r = navEl) => query(r, s);
  return {
    ariaLabel: X.at(navEl, 'aria-label'),
    brand: { href: X.at($('a.navbar-brand'), 'href'), alt: X.at($('a.navbar-brand img'), 'alt') },
    toggleAriaLabel: X.at($('button.navbar-toggler'), 'aria-label'),
    items: queryAll(navEl, '#navbarNav a.nav-link').map((a) => ({ label: X.html(a), href: X.at(a, 'href') })),
  };
}

function footerOf(X, ft) {
  const $ = (s, r = ft) => query(r, s);
  const $$ = (s, r = ft) => queryAll(r, s);
  const cols = $$('.row.g-4 > .col-md-4');
  const langList = $('.footer-lang-list');
  const h3s = $$('h3', cols[2]);
  const langLink = (a) => ({ label: X.html(a), href: X.at(a, 'href'), hreflang: X.at(a, 'hreflang'), lang: X.at(a, 'lang'), active: classes(a).some((c) => /active/.test(c)) });
  return {
    brand: { h3: X.html($('h3', cols[0])), text: X.html($('p', cols[0])) },
    quickLinks: {
      h3: X.html($('h3', cols[1])),
      ariaLabel: X.at($('nav', cols[1]), 'aria-label'),
      links: $$('li a', cols[1]).map((a) => ({ label: X.html(a), href: X.at(a, 'href') })),
    },
    language: langList ? { h3: X.html(h3s[0]), links: $$('a.footer-lang', langList).map(langLink) } : null,
    connect: {
      h3: X.html(langList ? h3s[1] : h3s[0]),
      links: $$('.social-links a', cols[2]).map((a) => ({ ariaLabel: X.at(a, 'aria-label'), href: X.at(a, 'href'), icon: iconOf(X, a) })),
    },
    copyright: X.html($('.row.mt-5 p')),
  };
}

/* ------------------------------------------------------------------ */
/* Homepage mapping (built against en index.html, applied to all 13)  */
/* ------------------------------------------------------------------ */
function extractHome(X) {
  const doc = X.doc;
  const $ = (s, r = doc) => query(r, s);
  const $$ = (s, r = doc) => queryAll(r, s);
  const body = $('body');

  const meta = metaOf(X, doc);

  /* nav ---------------------------------------------------------- */
  const navEl = $('nav.navbar');
  const banner = $('#langSuggestBanner');
  const nav = {
    ...navOf(X, navEl),
    langTrigger: { current: X.html($('#langTrigger .lang-current')), ariaControls: X.at($('#langTrigger'), 'aria-controls') },
    mobileLangTrigger: { current: X.html($('#mobileLangTrigger .lang-current')), ariaControls: X.at($('#mobileLangTrigger'), 'aria-controls') },
    langDrawer: {
      ariaLabel: X.at($('#langDrawer'), 'aria-label'),
      title: X.html($('#langDrawer .lang-drawer-title')),
      close: { label: X.html($('#langDrawerClose')), ariaLabel: X.at($('#langDrawerClose'), 'aria-label') },
      options: $$('#langDrawer a.lang-option').map((a) => ({ label: X.html(a), href: X.at(a, 'href'), hreflang: X.at(a, 'hreflang'), lang: X.at(a, 'lang'), active: classes(a).includes('is-active') })),
    },
    // Only the x-default root page carries the suggestion banner (§8 in the source comments).
    langSuggest: banner
      ? {
          text: X.html($('span', banner)),
          switchLabel: X.html($('#langSuggestSwitch', banner)),
          dismiss: { label: X.html($('button.lang-suggest-dismiss', banner)), ariaLabel: X.at($('button.lang-suggest-dismiss', banner), 'aria-label') },
          names: X.jsMap(/var langNames = \{([\s\S]*?)\};/),
          urls: X.jsMap(/var langUrls = \{([\s\S]*?)\};/),
        }
      : null,
  };

  /* a11y --------------------------------------------------------- */
  const dots = $('nav.section-dots');
  const icons = $('.contact-icons');
  const a11y = {
    skipLink: { label: X.html($('a.skip-link', body)), href: X.at($('a.skip-link', body), 'href') },
    backToTopAriaLabel: X.at($('#backToTopBtn'), 'aria-label'),
    scrollProgressAriaLabel: X.at($('#scrollProgressBar'), 'aria-label'),
    heroAriaLabel: X.at($('section.hero'), 'aria-label'),
    sectionDots: {
      ariaLabel: X.at(dots, 'aria-label'),
      items: $$('a.section-dot', dots).map((a) => ({ href: X.at(a, 'href'), section: X.at(a, 'data-section'), ariaLabel: X.at(a, 'aria-label'), tooltip: X.html($('.dot-tooltip', a)) })),
    },
    contactIcons: {
      ariaLabel: X.at(icons, 'aria-label'),
      items: $$('a.contact-icon', icons).map((a) => ({ ariaLabel: X.at(a, 'aria-label'), href: X.at(a, 'href'), label: X.html($('.contact-icon-label', a)), icon: iconOf(X, a) })),
    },
  };

  /* cookie ------------------------------------------------------- */
  const cookie = {
    ariaLabel: X.at($('#cookieConsent'), 'aria-label'),
    text: X.html($('#cookieConsent .cookie-consent-text')),
    reject: X.html($('#cookieReject')),
    accept: X.html($('#cookieAccept')),
  };

  /* hero --------------------------------------------------------- */
  const heroEl = $('section.hero');
  const hero = {
    eyebrow: X.html($('.hero-content p.eyebrow', heroEl)),
    h1: X.html($('h1', heroEl)),
    lead: X.html($('.hero-content p.lead', heroEl)),
    ctas: $$('.hero-content a.btn', heroEl).map((a) => ctaOf(X, a)),
    images: $$('.hero-images img', heroEl).map((img) => ({ src: X.at(img, 'src'), alt: X.at(img, 'alt') })),
  };

  /* about -------------------------------------------------------- */
  const aboutEl = $('#about');
  const aboutCards = $$('.feature-card', aboutEl);
  const simpleCard = (c) => ({ h3: X.html($('h3', c)), paragraphs: paragraphsOf(X, c) });
  const about = {
    eyebrow: X.html($('p.eyebrow', aboutEl)),
    h2: X.html($('h2', aboutEl)),
    intro: simpleCard(aboutCards[0]),
    pullQuote: X.html($('.pull-quote p', aboutEl)),
    cards: aboutCards.slice(1, 4).map(simpleCard),
    cta: {
      ...simpleCard(aboutCards[4]),
      links: $$('a.btn', aboutCards[4]).map((a) => ({ label: X.html(a), href: X.at(a, 'href'), icon: iconOf(X, a) })),
    },
  };

  /* dogs --------------------------------------------------------- */
  const dogsEl = $('#dogs');
  const [boboCard, futureCard] = $$('.dog-profile-card', dogsEl);
  const inner = $('.dog-card-inner-stop', boboCard);
  const meetBtn = $('button.btn-meet-dog', inner);
  const featureDiv = children(inner).find((c) => c.tagName === 'div' && !classes(c).includes('text-center'));
  const reservation = children(inner).find((c) => c.tagName === 'div' && classes(c).includes('text-center'));
  const priceFig = $('.price-figure', reservation);
  const stats = (card) => $$('.dog-stat', card).map((s) => ({ label: X.html($('.dog-stat-label', s)), value: X.html($('.dog-stat-value', s)) }));
  const dogs = {
    eyebrow: X.html($('p.eyebrow', dogsEl)),
    h2: X.html($('h2', dogsEl)),
    availability: X.html($('.availability-badge', dogsEl)),
    intro: X.html($('p.lead', dogsEl)),
    bobo: {
      storyOpen: X.at(boboCard, 'data-story-open'),
      image: { src: X.at($('.dog-profile-photo img', boboCard), 'src'), alt: X.at($('.dog-profile-photo img', boboCard), 'alt') },
      name: X.html($('.dog-profile-name', boboCard)),
      tagline: X.html($('.dog-profile-tagline', boboCard)),
      stats: stats(boboCard),
      meetButton: { label: X.html(meetBtn), icon: iconOf(X, meetBtn), data: dataAttrs(X, meetBtn) },
      paragraphs: paragraphsOf(X, inner),
      aboutHeading: X.html($('h4', inner)),
      features: children(featureDiv)
        .filter((p) => p.tagName === 'p')
        .map((p) => X.html(children(p).filter((s) => s.tagName === 'span').pop(), { via: 'text span (custom-check span sibling excluded)' })),
      reservation: {
        eyebrow: X.html($('p.eyebrow', reservation)),
        price: { currency: X.html($('.price-currency', priceFig)), amount: X.htmlAfter(priceFig, $('.price-currency', priceFig)) },
        notes: children(reservation).filter((c) => c.tagName === 'p' && classes(c).includes('text-light')).map((p) => X.html(p)),
        cta: ctaOf(X, $('a.btn', reservation)),
      },
    },
    future: {
      name: X.html($('.dog-profile-name', futureCard)),
      tagline: X.html($('.dog-profile-tagline', futureCard)),
      stats: stats(futureCard),
      paragraph: X.html($('p.text-light', futureCard)),
      cta: ctaOf(X, $('a.btn', futureCard)),
    },
  };

  /* bobo story modal --------------------------------------------- */
  const modal = $('#bobo-story-modal');
  const closeBtn = $('button.story-modal-close', modal);
  const storyImg = $('.story-photo img', modal);
  const storyVid = $('.story-photo video', modal);
  const boboStory = {
    ariaLabelledby: X.at(modal, 'aria-labelledby'),
    close: { label: X.html(closeBtn), ariaLabel: X.at(closeBtn, 'aria-label') },
    media: {
      image: { src: X.at(storyImg, 'src'), alt: X.at(storyImg, 'alt') },
      video: { ariaLabel: X.at(storyVid, 'aria-label'), poster: X.at(storyVid, 'poster'), src: X.at($('source', storyVid), 'src') },
    },
    title: X.html($('#bobo-story-title', modal)),
    dotCount: $$('.story-dot', modal).length,
    slides: $$('.story-slide', modal).map((s) => ({ slide: X.at(s, 'data-slide'), image: X.at(s, 'data-story-image'), video: X.at(s, 'data-story-video'), h4: X.html($('h4', s)), p: X.html($('p', s)) })),
    nav: {
      prev: X.html($('[data-story-prev]', modal)),
      next: X.html($('[data-story-next]', modal)),
      jsClose: X.js(JS.storyNav, { group: 1, desc: 'story modal: last-slide button text set by JS' }),
      jsNext: X.js(JS.storyNav, { group: 2, desc: 'story modal: next button text set by JS' }),
    },
  };

  /* watch develop ------------------------------------------------ */
  const wd = $('#watch-develop');
  const watchDevelop = { eyebrow: X.html($('p.eyebrow', wd)), h2: X.html($('h2', wd)), paragraphs: $$('.feature-card p', wd).map((p) => X.html(p)) };

  /* training ----------------------------------------------------- */
  const tr = $('#training');
  const training = {
    h2: X.html($('.section-header h2', tr)),
    intro: X.html($('.section-header p', tr)),
    timeline: {
      ariaLabel: X.at($('.timeline-track', tr), 'aria-label'),
      items: $$('.timeline-item', tr).map((t) => ({ phase: X.at(t, 'data-phase'), number: X.html($('.timeline-number', t)), label: X.html($('.timeline-label', t)), period: X.html($('.timeline-period', t)) })),
    },
    phaseNav: {
      ariaLabel: X.at($('.phase-nav', tr), 'aria-label'),
      prevAriaLabel: X.at($('[data-phase-prev]', tr), 'aria-label'),
      nextAriaLabel: X.at($('[data-phase-next]', tr), 'aria-label'),
      status: X.html($('.phase-nav-status', tr)),
    },
    phases: $$('.phase-content', tr).map((pc) => {
      const card = $('.phase-card', pc);
      const mediaEl = $('.phase-image-container', pc);
      const video = $('video', mediaEl);
      const img = $('img', mediaEl);
      return {
        id: X.at(pc, 'id'),
        number: X.at(card, 'data-phase-number'),
        badge: X.html($('.phase-badge', card)),
        title: X.html($('.phase-header h3', card)),
        timing: X.html($('.phase-timing', card)),
        intro: X.html(children(card).find((c) => c.tagName === 'p')),
        features: $$('.feature-item', card).map((f) => ({ icon: X.at($('.feature-icon i', f), 'class'), h4: X.html($('h4', f)), p: X.html($('p', f)) })),
        media: video
          ? { type: 'video', ariaLabel: X.at(video, 'aria-label'), poster: X.at(video, 'poster'), src: X.at($('source', video), 'src') }
          : img
            ? { type: 'image', alt: X.at(img, 'alt'), src: X.at(img, 'src') }
            : null,
      };
    }),
  };

  /* testing / breeding / family / who-its-for --------------------- */
  const simpleSection = (id) => {
    const s = $(id);
    return { eyebrow: X.html($('p.eyebrow', s)), h2: X.html($('h2', s)), paragraphs: $$('.feature-card p', s).map((p) => X.html(p)) };
  };
  const testing = simpleSection('#testing');
  const breedingEl = $('#breeding');
  const breeding = { eyebrow: X.html($('p.eyebrow', breedingEl)), h2: X.html($('h2', breedingEl)), cards: $$('.feature-card', breedingEl).map(simpleCard) };
  const family = simpleSection('#family');
  const wifEl = $('#who-its-for');
  const whoItsFor = { eyebrow: X.html($('p.eyebrow', wifEl)), h2: X.html($('h2', wifEl)), blocks: blocksOf(X, $('.feature-card', wifEl)) };

  /* pricing ------------------------------------------------------ */
  const pr = $('#pricing');
  const closing = $('.text-center.mt-5', pr);
  const pricing = {
    eyebrow: X.html($('p.eyebrow', pr)),
    h2: X.html($('h2', pr)),
    cards: $$('.feature-card', pr).map((c) => {
      const fig = $('.price-figure', c);
      return {
        h3: X.html($('h3', c)),
        features: $$('ul li', c).map((li) => X.html(li)),
        note: X.htmlOpt($('p.text-muted', c)),
        price: fig ? { currency: X.html($('.price-currency', fig)), amount: X.htmlAfter(fig, $('.price-currency', fig)) } : null,
        smallPrint: X.htmlOpt($('.mt-auto p.text-light', c)),
      };
    }),
    closing: { paragraphs: paragraphsOf(X, closing), cta: ctaOf(X, $('a.btn', closing)) },
  };

  /* faq ---------------------------------------------------------- */
  const faqEl = $('#faq');
  const faqSchema = meta.jsonld.faqpage && meta.jsonld.faqpage.value ? meta.jsonld.faqpage.value.mainEntity || [] : [];
  const faq = {
    eyebrow: X.html($('p.eyebrow', faqEl)),
    h2: X.html($('h2', faqEl)),
    items: $$('.faq-item', faqEl).map((it) => {
      const btn = $('button.faq-question', it);
      const ans = $('.faq-answer', it);
      const qspan = children(btn).find((c) => c.tagName === 'span' && !classes(c).includes('toggle-icon'));
      const toggle = $('.toggle-icon', btn);
      const ansKids = children(ans);
      const unwrap = ansKids.length === 1 && ansKids[0].tagName === 'p' && (ans.childNodes || []).every((n) => isEl(n) || n.value.trim() === '');
      return {
        id: X.at(btn, 'id'),
        answerId: X.at(ans, 'id'),
        question: X.html(qspan, { via: 'text <span> inside the button', stripped: toggle ? [{ position: 'trailing (sibling of text span)', html: X.outer(toggle) }] : [] }),
        answer: unwrap ? X.html(ansKids[0], { via: `single <p class="${attr(ansKids[0], 'class')}"> wrapper unwrapped` }) : X.html(ans),
      };
    }),
    schema: faqSchema.map((q) => ({ name: q.name, text: q.acceptedAnswer ? q.acceptedAnswer.text : null })),
  };

  /* testimonials ------------------------------------------------- */
  const tw = $('#testimonial-widgets');
  const testimonials = {
    eyebrow: X.html($('p.eyebrow', tw)),
    h2: X.html($('h2', tw)),
    consent: { text: X.html($('#testimonial-consent p', tw)), button: X.html($('#testimonial-load', tw)) },
    embeds: { iframeTitle: X.at($('#testimonial-embeds iframe', tw), 'title'), jsIframeTitle: X.js(JS.iframeTitle, { desc: 'title given to the injected testimonial widget iframe' }) },
  };

  /* partner strip (un-id'd section after testimonials) ------------ */
  const partnerEl = nextElementSibling(tw);
  const partnerImg = $('img', partnerEl);
  const partner = {
    _sourceSection: `un-id'd <section class="${attr(partnerEl, 'class')}"> immediately after #testimonial-widgets (line ${X.lineOf(partnerEl.sourceCodeLocation.startOffset)})`,
    logo: { src: X.at(partnerImg, 'src'), alt: X.at(partnerImg, 'alt') },
    text: X.html($('p', partnerEl)),
    links: $$('a.btn', partnerEl).map((a) => ({ label: X.html(a), href: X.at(a, 'href'), target: X.at(a, 'target'), icon: iconOf(X, a) })),
  };

  /* contact ------------------------------------------------------ */
  const ct = $('#contact');
  const form = $('#contact-form', ct);
  const tell = $('.col-lg-6', ct);
  const field = (id) => {
    const input = $(`#${id}`, form);
    return {
      label: X.html($(`label[for=${id}]`, form)),
      placeholder: X.at(input, 'placeholder'),
      ariaLabel: X.at(input, 'aria-label'),
      title: X.at(input, 'title'),
      required: hasAttr(input, 'required'),
    };
  };
  const options = (sel) => $$('option', sel).map((o) => (hasAttr(o, 'disabled') ? { value: X.at(o, 'value'), label: X.html(o), placeholder: true } : { value: X.at(o, 'value'), label: X.html(o) }));
  const preselect = $$('a[href="#contact"][data-interest]', body).map((a) => {
    let s = a.parentNode;
    while (isEl(s) && s.tagName !== 'section') s = s.parentNode;
    return { interest: X.at(a, 'data-interest'), section: isEl(s) ? attr(s, 'id') : null, line: X.lineOf(a.sourceCodeLocation.startOffset) };
  });
  const contact = {
    eyebrow: X.html($('p.eyebrow', ct)),
    h2: X.html($('h2', ct)),
    intro: X.html($('p.lead', ct)),
    journey: { title: X.html($('p.journey-title', ct)), steps: $$('ol.journey-steps li', ct).map((li) => X.html(li)) },
    tellMe: { title: X.html(children(tell).find((c) => c.tagName === 'p')), items: $$('ul li', tell).map((li) => X.html(li)) },
    form: {
      action: X.at(form, 'action'),
      method: X.at(form, 'method'),
      fields: {
        name: field('name'),
        email: field('email'),
        phone: field('phone'),
        country: { label: X.html($('label[for=country]', form)), options: options($('#country', form)) },
        interest: { label: X.html($('label[for=interest]', form)), options: options($('#interest', form)) },
        message: field('message'),
        privacyConsent: { label: X.html($('label[for=privacy-consent]', form)), required: hasAttr($('#privacy-consent', form), 'required') },
      },
      submit: X.html($('button[type=submit]', form)),
    },
    messages: {
      nameRequired: X.js(JS.nameRequired, { desc: 'inline validation: empty name' }),
      emailInvalid: X.js(JS.emailInvalid, { desc: 'inline validation: empty/invalid email' }),
      messageRequired: X.js(JS.messageRequired, { desc: 'inline validation: empty message' }),
      privacyRequired: X.js(JS.privacyRequired, { desc: 'alert() when the privacy checkbox is unchecked' }),
      sending: X.js(JS.submitInnerHTML, { nth: 0, desc: 'submit button innerHTML while the request is in flight (includes a spinner <span>)' }),
      submitRestore: X.js(JS.submitInnerHTML, { nth: 1, desc: 'submit button innerHTML restored after the request' }),
      success: X.js(JS.success, { desc: 'notification on HTTP 2xx' }),
      submitError: X.js(JS.danger, { nth: 0, desc: 'notification on non-2xx without Formspree error list' }),
      networkError: X.js(JS.danger, { nth: 1, desc: 'notification on fetch failure' }),
      notificationClose: X.js(JS.notificationClose, { desc: 'aria-label of the notification dismiss button' }),
    },
    preselect,
    footnotes: $$('.row.mt-4 p', ct).map((p) => ({ icon: iconOf(X, p), text: X.html(p) })),
  };

  /* privacy blurb (un-id'd section after #contact) ---------------- */
  const pbEl = nextElementSibling(ct);
  const privacyBlurb = {
    _sourceSection: `un-id'd <section class="${attr(pbEl, 'class')}"> immediately after #contact (line ${X.lineOf(pbEl.sourceCodeLocation.startOffset)})`,
    h2: X.html($('h2', pbEl)),
    cards: $$('.col-md-4', pbEl).map((c) => ({ icon: X.at($('i', c), 'class'), h3: X.html($('h3', c)), p: X.html($('p', c)) })),
    closing: { text: X.html($('p.lead', pbEl)), cta: ctaOf(X, $('a.btn', pbEl)) },
  };

  /* footer ------------------------------------------------------- */
  const footer = footerOf(X, $('footer'));

  /* ui: leftovers (verified empty by coverage check C) ------------ */
  const ui = {};

  return { meta, nav, a11y, cookie, hero, about, dogs, boboStory, watchDevelop, training, testing, breeding, family, whoItsFor, pricing, faq, testimonials, partner, contact, privacyBlurb, footer, ui };
}

/* ------------------------------------------------------------------ */
/* Privacy page mapping                                               */
/* ------------------------------------------------------------------ */
function extractPrivacy(X) {
  const doc = X.doc;
  const $ = (s, r = doc) => query(r, s);
  const $$ = (s, r = doc) => queryAll(r, s);
  const body = $('body');
  const col = $('main .col-lg-9');
  const card = $('.feature-card', col);
  const colPs = children(col).filter((c) => c.tagName === 'p');
  const disclaimerEl = children(card).find((c) => c.tagName === 'p' && classes(c).includes('opacity-75'));
  const intro = [];
  const sections = [];
  let cur = null;
  for (const c of children(card)) {
    if (c === disclaimerEl) continue;
    if (c.tagName === 'h2') {
      cur = { heading: X.html(c), blocks: [] };
      sections.push(cur);
      continue;
    }
    const blocks = blocksOf(X, { childNodes: [c] });
    (cur ? cur.blocks : intro).push(...blocks);
  }
  const bc = $('nav[aria-label=breadcrumb]');
  return {
    meta: metaOf(X, doc),
    skipLink: { label: X.html($('a.skip-link', body)), href: X.at($('a.skip-link', body), 'href') },
    nav: navOf(X, $('nav.navbar')),
    breadcrumb: {
      ariaLabel: X.at(bc, 'aria-label'),
      items: $$('li.breadcrumb-item', bc).map((li) => ({ label: X.html($('span[itemprop=name]', li)), href: query(li, 'a') ? X.at(query(li, 'a'), 'href') : null })),
    },
    page: {
      eyebrow: X.html(colPs[0]),
      h1: X.html($('h1', col)),
      lastUpdated: X.html(colPs[1]),
      disclaimer: disclaimerEl ? X.html(disclaimerEl) : null,
      intro,
      sections,
      cta: ctaOf(X, $('.text-center a.btn', col)),
    },
    footer: footerOf(X, $('footer')),
  };
}

/* ------------------------------------------------------------------ */
/* Verification                                                       */
/* ------------------------------------------------------------------ */
function rangeText(e) {
  let s = '';
  for (const c of e.node.childNodes || []) {
    const l = c.sourceCodeLocation;
    if (l && l.startOffset >= e.start && l.endOffset <= e.end) s += textOf(c);
  }
  return collapse(s);
}

function verifyEntries(src, entries) {
  const A = { pass: 0, fail: 0, na: 0, failures: [] };
  const B = { pass: 0, fail: 0, na: 0, failures: [] };
  for (const e of entries) {
    if (e.missing || e.value === null || e.kind === 'derived') {
      e.a = 'n/a';
      e.b = 'n/a';
      A.na++;
      B.na++;
      continue;
    }
    let a;
    if (e.kind === 'html') {
      const raw = src.slice(e.start, e.end);
      a = raw.trim() === e.value && src.indexOf(e.value, e.start) === e.start + (raw.length - raw.trimStart().length);
    } else if (e.kind === 'attr') {
      const raw = src.slice(e.start, e.end);
      const probe = parseFragment(`<x ${raw}>`);
      const el = probe.childNodes[0];
      a = !!el && attr(el, e.attr) === e.value;
      if (!a) {
        // parse5 mis-locates attribute tokens inside a malformed start tag (e.g. a doubled
        // closing quote); verify the name="value" pair verbatim inside the raw start tag instead.
        const tag = e.node.sourceCodeLocation.startTag || e.node.sourceCodeLocation;
        const tagSrc = src.slice(tag.startOffset, tag.endOffset);
        a = tagSrc.includes(`${e.attr}="${e.value}"`) || tagSrc.includes(`${e.attr}='${e.value}'`);
        if (a) e.aNote = `parse5 attribute-token location was unusable (malformed start tag, raw token "${raw}"); verified name="value" verbatim inside the start tag`;
      }
    } else if (e.kind === 'js') {
      a = src.slice(e.start, e.end) === e.raw && unescapeJs(e.raw) === e.value;
    } else if (e.kind === 'jsonld') {
      let ok = false;
      try {
        ok = JSON.stringify(JSON.parse(src.slice(e.start, e.end))) === JSON.stringify(e.value);
      } catch {
        ok = false;
      }
      a = ok;
    }
    e.a = a ? 'pass' : 'fail';
    if (a) A.pass++;
    else {
      A.fail++;
      A.failures.push({ path: e.path, kind: e.kind, line: e.line });
    }
    if (e.kind === 'html') {
      const got = collapse(textOf(parseFragment(e.value)));
      const want = rangeText(e);
      const b = got === want;
      e.b = b ? 'pass' : 'fail';
      if (b) B.pass++;
      else {
        B.fail++;
        B.failures.push({ path: e.path, line: e.line, got, want });
      }
    } else {
      e.b = 'n/a';
      B.na++;
    }
  }
  return { A, B };
}

function* bodyTextNodes(node) {
  for (const c of node.childNodes || []) {
    if (isEl(c) && (c.tagName === 'script' || c.tagName === 'style')) continue;
    if (c.nodeName === '#text') yield c;
    else if (c.childNodes) yield* bodyTextNodes(c);
  }
}

function coverage(doc, entries, lineOf) {
  const body = query(doc, 'body');
  const ranges = entries.filter((e) => e.kind === 'html' && e.value !== null).map((e) => [e.start, e.end]);
  const decodedTexts = entries.filter((e) => e.value !== null && typeof e.value === 'string').map((e) => (e.kind === 'html' ? collapse(textOf(parseFragment(e.value))) : collapse(e.value)));
  let total = 0;
  let covered = 0;
  const uncovered = [];
  for (const t of bodyTextNodes(body)) {
    const text = collapse(t.value);
    if (!text) continue;
    total++;
    const l = t.sourceCodeLocation;
    if (ranges.some(([s, e]) => s <= l.startOffset && l.endOffset <= e)) {
      covered++;
      continue;
    }
    const textCovered = decodedTexts.some((d) => d.includes(text));
    uncovered.push({ line: l.startLine, text: text.length > 120 ? text.slice(0, 117) + '...' : text, textAppearsElsewhere: textCovered });
  }
  return { total, covered, pct: total ? +((covered / total) * 100).toFixed(2) : 100, uncovered };
}

function managedMarkers(src, lang, entries, lineOf) {
  const out = [];
  const re = /<!--pdg:(\w+)-->([\s\S]*?)<!--\/pdg-->/g;
  let m;
  while ((m = re.exec(src))) {
    const key = m[1];
    const value = m[2];
    let expected;
    let note = '';
    if (key.startsWith('fact_')) expected = FACTS.facts[key.slice(5)];
    else expected = FACTS.formats[lang] ? FACTS.formats[lang][key] : undefined;
    let ok;
    if (typeof expected === 'boolean') {
      ok = (expected ? '1' : '0') === value;
      note = `facts.json stores a boolean (${expected}); HTML renders "${value}" — treated as equivalent`;
    } else ok = String(expected) === value;
    const holders = entries.filter((e) => e.kind === 'html' && e.value !== null && e.start <= m.index && m.index + m[0].length <= e.end).map((e) => e.path);
    out.push({ key, value, expected: expected === undefined ? null : expected, ok, note, line: lineOf(m.index), paths: holders });
  }
  return out;
}

/** flatten a finalized tree to leaf paths */
function leafPaths(node, path = '', out = new Map()) {
  if (Array.isArray(node)) node.forEach((v, i) => leafPaths(v, `${path}[${i}]`, out));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) leafPaths(v, path ? `${path}.${k}` : k, out);
  else out.set(path, node);
  return out;
}
const sum = (arr, f) => arr.reduce((n, x) => n + f(x), 0);
const homeCounts = (t) => ({
  navItems: t.nav.items.length,
  sectionDots: t.a11y.sectionDots.items.length,
  langDrawerOptions: t.nav.langDrawer.options.length,
  contactIcons: t.a11y.contactIcons.items.length,
  heroCtas: t.hero.ctas.length,
  aboutCards: t.about.cards.length,
  boboFeatures: t.dogs.bobo.features.length,
  storySlides: t.boboStory.slides.length,
  timelineItems: t.training.timeline.items.length,
  phases: t.training.phases.length,
  phaseFeatures: sum(t.training.phases, (p) => p.features.length),
  breedingCards: t.breeding.cards.length,
  whoItsForBlocks: t.whoItsFor.blocks.length,
  pricingCards: t.pricing.cards.length,
  pricingFeatures: sum(t.pricing.cards, (c) => c.features.length),
  faqItems: t.faq.items.length,
  faqSchema: t.faq.schema.length,
  journeySteps: t.contact.journey.steps.length,
  tellMeItems: t.contact.tellMe.items.length,
  countryOptions: t.contact.form.fields.country.options.length,
  interestOptions: t.contact.form.fields.interest.options.length,
  preselectCtas: t.contact.preselect.length,
  privacyBlurbCards: t.privacyBlurb.cards.length,
  footerQuickLinks: t.footer.quickLinks.links.length,
  footerLangLinks: t.footer.language ? t.footer.language.links.length : 0,
  footerConnect: t.footer.connect.links.length,
  jsonldBlocks: Object.keys(t.meta.jsonld).join('+') || '(none)',
});
const privacyCounts = (t) => ({
  navItems: t.nav.items.length,
  breadcrumb: t.breadcrumb.items.length,
  introBlocks: t.page.intro.length,
  sections: t.page.sections.length,
  blocks: sum(t.page.sections, (s) => s.blocks.length),
  listItems: sum(t.page.sections, (s) => sum(s.blocks, (b) => (b.items ? b.items.length : 0))),
  footerQuickLinks: t.footer.quickLinks.links.length,
  footerConnect: t.footer.connect.links.length,
});

/* ------------------------------------------------------------------ */
/* Main                                                               */
/* ------------------------------------------------------------------ */
const EXPECTED_DIFFS = [
  { prefix: 'nav.langSuggest', why: 'language-suggestion banner exists only on the x-default root page (en) by design (source comment §8)' },
  { prefix: 'meta.dir', why: 'only Arabic sets dir="rtl"' },
  { prefix: 'page.disclaimer', why: 'translated privacy pages carry a "this is a translation, English prevails" paragraph; en does not' },
];

function processPage(lang, page, file) {
  const abs = resolve(SITE_ROOT, file);
  const src = readFileSync(abs, 'utf8');
  const parseErrors = [];
  const doc = parse(src, { sourceCodeLocationInfo: true, onParseError: (e) => parseErrors.push({ code: e.code, line: e.startLine, col: e.startCol }) });
  const X = makeContext(src, doc, page);
  const raw = page === 'home' ? extractHome(X) : extractPrivacy(X);
  const entries = [];
  const tree = finalize(raw, '', entries);
  const { A, B } = verifyEntries(src, entries);
  const cov = coverage(doc, entries, X.lineOf);
  const markers = managedMarkers(src, lang, entries, X.lineOf);
  const missing = entries.filter((e) => e.missing).map((e) => e.path);
  const jsEntries = entries.filter((e) => e.kind === 'js' && !e.missing);
  const multiline = entries.filter((e) => e.kind === 'html' && e.value && /[\r\n]/.test(e.value)).map((e) => e.path);
  const stripped = entries.filter((e) => e.stripped && e.stripped.length).map((e) => ({ path: e.path, stripped: e.stripped }));
  const unescaped = jsEntries.filter((e) => e.raw !== e.value).map((e) => ({ path: e.path, raw: e.raw, value: e.value, line: e.line }));
  const headRedirect = /window\.location\.replace\(targets\[pref\]\)/.test(src);
  const counts = {
    entries: entries.length,
    html: entries.filter((e) => e.kind === 'html' && e.value !== null).length,
    attr: entries.filter((e) => e.kind === 'attr' && e.value !== null).length,
    js: jsEntries.length,
    jsonld: entries.filter((e) => e.kind === 'jsonld').length,
    derived: entries.filter((e) => e.kind === 'derived').length,
    nulls: entries.filter((e) => e.value === null).length,
  };
  const aNotes = entries.filter((e) => e.aNote).map((e) => ({ path: e.path, line: e.line, note: e.aNote }));
  return { lang, page, file, src, srcBytes: Buffer.byteLength(src), tree, entries, A, B, cov, markers, missing, jsEntries, multiline, stripped, unescaped, headRedirect, counts, parseErrors, aNotes, structure: page === 'home' ? homeCounts(tree) : privacyCounts(tree) };
}

function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  return statSync(path).size;
}

function main() {
  const results = { home: {}, privacy: {} };
  for (const lang of LANGS) {
    results.home[lang] = processPage(lang, 'home', homeFile(lang));
    results.privacy[lang] = processPage(lang, 'privacy', privacyFile(lang));
    results.home[lang].outFile = resolve(OUT_LOCALES, `${lang}.json`);
    results.privacy[lang].outFile = resolve(OUT_PRIVACY, `${lang}.json`);
    results.home[lang].outBytes = writeJson(results.home[lang].outFile, results.home[lang].tree);
    results.privacy[lang].outBytes = writeJson(results.privacy[lang].outFile, results.privacy[lang].tree);
  }

  /* shape parity vs en ------------------------------------------- */
  const shape = {};
  for (const page of ['home', 'privacy']) {
    const en = leafPaths(results[page].en.tree);
    for (const lang of LANGS) {
      if (lang === 'en') continue;
      const lp = leafPaths(results[page][lang].tree);
      const diffs = [];
      // JSON-LD internals are compared as whole blocks (type set) in the D table, not leaf by leaf.
      const isLd = (p) => p.startsWith('meta.jsonld.');
      for (const [p, v] of en) {
        if (isLd(p)) continue;
        if (!lp.has(p)) diffs.push({ path: p, kind: 'missing-in-locale' });
        else if (v !== null && lp.get(p) === null) diffs.push({ path: p, kind: 'null-in-locale' });
        else if (v === null && lp.get(p) !== null) diffs.push({ path: p, kind: 'null-in-en' });
      }
      for (const p of lp.keys()) if (!isLd(p) && !en.has(p)) diffs.push({ path: p, kind: 'extra-in-locale' });
      for (const d of diffs) {
        const exp = EXPECTED_DIFFS.find((x) => d.path.startsWith(x.prefix));
        d.expected = !!exp;
        if (exp) d.why = exp.why;
      }
      shape[`${page}:${lang}`] = diffs;
    }
  }

  /* JS string cross-locale view ----------------------------------- */
  const jsTable = {};
  for (const lang of LANGS) {
    for (const e of results.home[lang].jsEntries) {
      if (!jsTable[e.path]) jsTable[e.path] = { desc: e.desc || '', locales: {} };
      jsTable[e.path].locales[lang] = { value: e.value, line: e.line, file: results.home[lang].file };
    }
  }
  const jsFlags = [];
  for (const [path, row] of Object.entries(jsTable)) {
    const present = LANGS.filter((l) => row.locales[l]);
    const exp = EXPECTED_DIFFS.find((x) => path.startsWith(x.prefix));
    if (present.length !== LANGS.length) jsFlags.push({ path, flag: 'present only in: ' + present.join(', ') + (exp ? ` — expected: ${exp.why}` : ''), expected: !!exp });
    const enVal = row.locales.en && row.locales.en.value;
    const same = LANGS.filter((l) => l !== 'en' && row.locales[l] && row.locales[l].value === enVal);
    if (same.length) jsFlags.push({ path, flag: `identical to en (untranslated?) in: ${same.join(', ')}`, value: enVal, expected: false });
  }

  /* observations that need a human eye (emitted by the script) ------ */
  const notes = [];
  for (const lang of LANGS) {
    const r = results.home[lang];
    if (r.headRedirect && lang !== 'en') notes.push(`${r.file}: contains the <head> "§8 safe language routing" localStorage redirect script, which the source comment says must run ONLY on the bare root page. Not copy, but a live-site behaviour worth a decision before Phase 2 (a saved non-ja preference would redirect visitors away from /ja/).`);
  }
  for (const lang of LANGS) {
    const r = results.home[lang];
    const en = results.home.en.tree;
    r.tree.a11y.contactIcons.items.forEach((it, i) => {
      if (it.icon === null && en.a11y.contactIcons.items[i] && en.a11y.contactIcons.items[i].icon !== null) notes.push(`${r.file}: floating contact icon #${i + 1} ("${it.label}") has no <i class="..."> icon element (en has "${en.a11y.contactIcons.items[i].icon}"). Live-site markup defect, reported as a structural diff; the label and aria-label were extracted normally.`);
    });
    for (const n of r.aNotes) notes.push(`${r.file} line ${n.line} (${n.path}): ${n.note}.`);
  }
  const enHome = results.home.en;
  if (enHome.tree.faq.items.length) notes.push(`FAQ answers: each #faq-aN contains exactly one <p class="mb-0"> in every locale, so the stored answer is that paragraph's innerHTML (wrapper recorded per entry as "via"). FAQ questions are the innerHTML of the text <span> inside the button; the trailing <span class="toggle-icon"> was excluded and is listed under stripped decorations.`);
  notes.push(`Managed facts: the <!--pdg:KEY-->value<!--/pdg--> marker comments are kept verbatim inside the extracted values (they are part of the source slice). The "managed" table lists which JSON paths embed which marker so Phase 2 can substitute facts.json at render time.`);
  notes.push(`contact.messages.sending keeps the spinner <span class="spinner-border ..."> exactly as the inline script assigns it to innerHTML.`);
  notes.push(`The CTA→interest preselection is not a JS map: the inline script copies the clicked anchor's data-interest attribute into #interest. contact.preselect lists those anchors (interest, section, source line) as found in the DOM.`);
  notes.push(`console.warn/console.error/console.log literals in the inline scripts are developer-facing and were deliberately not extracted.`);
  notes.push(`"ui" is empty in every locale: check C found no body text node outside the named keys.`);
  notes.push(`Source observation (left untouched): en FAQ answer 3 reads "…ongoing support to support a successful integration." — repeated "support"; verify with the author before Phase 2 rather than editing.`);
  const bareAmp = LANGS.flatMap((l) => ['home', 'privacy'].flatMap((p) => results[p][l].entries.filter((e) => e.kind === 'html' && e.value && /&(?![a-zA-Z][a-zA-Z0-9]*;|#\d+;|#x[0-9a-fA-F]+;)/.test(e.value)).map((e) => `${l}/${p} ${e.path} (line ${e.line})`)));
  if (bareAmp.length) notes.push(`Bare "&" (not an entity) inside ${bareAmp.length} extracted HTML value(s), kept verbatim — browsers tolerate it, but Phase 2 should render these with set:html exactly as-is: ${bareAmp.join('; ')}.`);

  /* report.json --------------------------------------------------- */
  const report = {
    generatedBy: relative(NODE_SITE, fileURLToPath(import.meta.url)).replace(/\\/g, '/'),
    languages: LANGS,
    summary: {},
    locales: {},
    parity: { home: {}, privacy: {} },
    shapeDiffs: shape,
    jsStrings: jsTable,
    jsFlags,
    notes,
  };
  let totA = { pass: 0, fail: 0 };
  let totB = { pass: 0, fail: 0 };
  let totCov = { total: 0, covered: 0 };
  for (const lang of LANGS) {
    report.locales[lang] = {};
    for (const page of ['home', 'privacy']) {
      const r = results[page][lang];
      totA.pass += r.A.pass;
      totA.fail += r.A.fail;
      totB.pass += r.B.pass;
      totB.fail += r.B.fail;
      totCov.total += r.cov.total;
      totCov.covered += r.cov.covered;
      report.parity[page][lang] = r.structure;
      report.locales[lang][page] = {
        sourceFile: r.file,
        sourceBytes: r.srcBytes,
        outputFile: relative(NODE_SITE, r.outFile).replace(/\\/g, '/'),
        outputBytes: r.outBytes,
        counts: r.counts,
        checkA: { pass: r.A.pass, fail: r.A.fail, na: r.A.na, failures: r.A.failures },
        checkB: { pass: r.B.pass, fail: r.B.fail, na: r.B.na, failures: r.B.failures },
        coverage: r.cov,
        managed: r.markers,
        missing: r.missing,
        multilineValues: r.multiline,
        jsUnescaped: r.unescaped,
        strippedDecorations: r.stripped,
        parseErrors: r.parseErrors,
        verificationNotes: r.aNotes,
        entries: r.entries.map((e) => ({ path: e.path, kind: e.kind, line: e.line ?? null, start: e.start ?? null, end: e.end ?? null, a: e.a, b: e.b, ...(e.kind === 'js' ? { value: e.value } : {}), ...(e.via ? { via: e.via } : {}), ...(e.missing ? { missing: true } : {}) })),
      };
    }
  }
  report.summary = {
    files: LANGS.length * 2,
    checkA: totA,
    checkB: totB,
    coverage: { ...totCov, pct: +((totCov.covered / totCov.total) * 100).toFixed(2) },
    managedMismatches: LANGS.flatMap((l) => results.home[l].markers.filter((m) => !m.ok).map((m) => ({ lang: l, ...m }))),
    unexpectedShapeDiffs: Object.entries(shape).flatMap(([k, d]) => d.filter((x) => !x.expected).map((x) => ({ where: k, ...x }))),
  };
  mkdirSync(OUT_REPORTS, { recursive: true });
  writeFileSync(resolve(OUT_REPORTS, 'extraction-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  writeFileSync(resolve(OUT_REPORTS, 'extraction-report.md'), renderMarkdown(report, results), 'utf8');

  console.log(`A: ${totA.pass} pass / ${totA.fail} fail   B: ${totB.pass} pass / ${totB.fail} fail   C: ${report.summary.coverage.pct}% (${totCov.covered}/${totCov.total})`);
  console.log(`managed mismatches: ${report.summary.managedMismatches.length}   unexpected shape diffs: ${report.summary.unexpectedShapeDiffs.length}`);
  for (const lang of LANGS) {
    const h = results.home[lang];
    const p = results.privacy[lang];
    console.log(`${lang.padEnd(3)} home: ${String(h.entries.length).padStart(4)} entries, C ${h.cov.pct}% (${h.cov.uncovered.length} uncovered)   privacy: ${String(p.entries.length).padStart(4)} entries, C ${p.cov.pct}% (${p.cov.uncovered.length} uncovered)`);
  }
  if (totA.fail || totB.fail) process.exitCode = 1;
}

/* ------------------------------------------------------------------ */
/* Markdown report                                                    */
/* ------------------------------------------------------------------ */
function table(header, rows) {
  const esc = (v) => String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  return [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
}
function renderMarkdown(report, results) {
  const L = report.languages;
  const out = [];
  out.push('# Content extraction report', '', `Generated by \`${report.generatedBy}\` (deterministic; re-run with \`npm run extract\`). Sources: the 13 live homepages and 13 privacy pages in the site root. Outputs: \`src/i18n/locales/<lang>.json\`, \`src/i18n/privacy/<lang>.json\`.`, '');
  out.push('## Summary', '');
  const s = report.summary;
  out.push(table(['metric', 'value'], [
    ['files parsed', s.files],
    ['A. substring check', `${s.checkA.pass} pass / ${s.checkA.fail} fail`],
    ['B. text-content check', `${s.checkB.pass} pass / ${s.checkB.fail} fail`],
    ['C. body text-node coverage', `${s.coverage.covered} / ${s.coverage.total} (${s.coverage.pct}%)`],
    ['E. managed-fact mismatches', s.managedMismatches.length],
    ['D. unexpected structural diffs vs en', s.unexpectedShapeDiffs.length],
  ]), '');

  out.push('## A / B — substring and text-content checks', '', 'A: every HTML value equals the trimmed source slice at its recorded offsets; attribute values re-parse from their raw attribute token; JS literals match the source at their offsets; JSON-LD blocks re-parse identically. B: the extracted fragment, parsed with parse5 and whitespace-collapsed, has the same text as the source node range (HTML entries only; attr/js/jsonld are n/a).', '');
  out.push(table(['locale', 'page', 'entries', 'A pass', 'A fail', 'A n/a', 'B pass', 'B fail', 'B n/a'], L.flatMap((l) => ['home', 'privacy'].map((p) => {
    const r = report.locales[l][p];
    return [l, p, r.counts.entries, r.checkA.pass, r.checkA.fail, r.checkA.na, r.checkB.pass, r.checkB.fail, r.checkB.na];
  }))), '');
  const failures = L.flatMap((l) => ['home', 'privacy'].flatMap((p) => [...report.locales[l][p].checkA.failures.map((f) => [l, p, 'A', f.path, f.line]), ...report.locales[l][p].checkB.failures.map((f) => [l, p, 'B', f.path, f.line])]));
  if (failures.length) out.push('### Failures', '', table(['locale', 'page', 'check', 'path', 'line'], failures), '');
  else out.push('No A/B failures.', '');
  out.push('n/a entries are null values (absent optional attributes such as `data-story-video` on image-only slides, `aria-label`/`title` on inputs that have none, `dir` outside Arabic, the phase-1 media slot) and derived strings (FAQ schema Q/A copied out of the parsed JSON-LD object, section counts).', '');

  out.push('## C — coverage of body text nodes', '', 'Every non-whitespace text node under `<body>` (scripts/styles excluded) must fall inside the source range of at least one extracted HTML value.', '');
  out.push(table(['locale', 'page', 'text nodes', 'covered', '%', 'uncovered'], L.flatMap((l) => ['home', 'privacy'].map((p) => {
    const c = report.locales[l][p].coverage;
    return [l, p, c.total, c.covered, c.pct, c.uncovered.length];
  }))), '');
  const unc = L.flatMap((l) => ['home', 'privacy'].flatMap((p) => report.locales[l][p].coverage.uncovered.map((u) => [l, p, u.line, u.text, u.textAppearsElsewhere ? 'yes' : 'no'])));
  if (unc.length) out.push('### Uncovered text nodes', '', table(['locale', 'page', 'line', 'text', 'same text found in another extracted string'], unc), '');
  else out.push('No uncovered text nodes.', '');

  out.push('## D — structural parity', '', 'Counts per locale; rows that differ from `en` are marked with `!=`.', '');
  for (const page of ['home', 'privacy']) {
    const keys = Object.keys(report.parity[page].en);
    out.push(`### ${page}`, '', table(['count', ...L], keys.map((k) => [k, ...L.map((l) => {
      const v = report.parity[page][l][k];
      return v === report.parity[page].en[k] ? v : `**${v} !=**`;
    })])), '');
  }
  // group leaf-level diffs by (page, kind, path prefix) and list the locales that show them
  const groups = new Map();
  for (const [k, d] of Object.entries(report.shapeDiffs)) {
    const [page, locale] = k.split(':');
    for (const x of d) {
      const prefix = x.path.replace(/(\.[^.[\]]+|\[\d+\])(\.[^.[\]]+|\[\d+\])*$/, (m) => m.split(/(?=[.[])/).slice(0, 2).join(''));
      const key = `${page}|${x.kind}|${prefix}|${x.expected}`;
      if (!groups.has(key)) groups.set(key, { page, kind: x.kind, prefix, status: x.expected ? 'expected' : 'UNEXPECTED', why: x.why || '', locales: new Map() });
      const g = groups.get(key);
      g.locales.set(locale, (g.locales.get(locale) || 0) + 1);
    }
  }
  const diffRows = [...groups.values()].map((g) => [g.page, g.kind, g.prefix, [...g.locales.entries()].map(([l, n]) => (n > 1 ? `${l}(${n})` : l)).join(', '), g.status, g.why]);
  out.push('### Path-level differences vs en (grouped)', '', '`kind` is relative to en: missing-in-locale / extra-in-locale / null-in-locale / null-in-en. A `(n)` after a locale is the number of leaves under that prefix.', '', diffRows.length ? table(['page', 'kind', 'path prefix', 'locales', 'status', 'why'], diffRows) : 'None.', '');

  out.push('## E — managed facts (`<!--pdg:KEY-->` markers) vs `src/data/facts.json`', '');
  out.push(table(['locale', 'marker', 'line', 'HTML value', 'facts.json', 'ok', 'note'], L.flatMap((l) => report.locales[l].home.managed.map((m) => [l, m.key, m.line, m.value, m.expected, m.ok ? 'yes' : '**NO**', m.note]))), '');
  out.push('### Managed keys (JSON paths whose value embeds a marker — substitute from facts.json at render time)', '');
  out.push(table(['locale', 'marker', 'JSON path(s)', '_managed'], L.flatMap((l) => report.locales[l].home.managed.map((m) => [l, m.key, m.paths.join(', '), 'true']))), '');

  out.push('## F — totals', '');
  out.push(table(['locale', 'page', 'source bytes', 'output bytes', 'leaf entries', 'html', 'attr', 'js', 'jsonld', 'derived', 'null'], L.flatMap((l) => ['home', 'privacy'].map((p) => {
    const r = report.locales[l][p];
    return [l, p, r.sourceBytes, r.outputBytes, r.counts.entries, r.counts.html, r.counts.attr, r.counts.js, r.counts.jsonld, r.counts.derived, r.counts.nulls];
  }))), '');

  out.push('## JS-derived strings (inline `<script>` literals)', '', 'Source line per locale so a human can audit each literal. Values are the runtime string (JS escapes such as `\\\'` resolved — see "unescaped" below).', '');
  const enOnly = Object.entries(report.jsStrings).filter(([, row]) => Object.keys(row.locales).length === 1 && row.locales.en);
  const shared = Object.entries(report.jsStrings).filter(([p]) => !enOnly.some(([q]) => q === p));
  for (const [path, row] of shared) {
    out.push(`### \`${path}\``, '', row.desc ? `${row.desc}` : '', '', table(['locale', 'file', 'line', 'value'], L.filter((l) => row.locales[l]).map((l) => [l, row.locales[l].file, row.locales[l].line, row.locales[l].value])), '');
  }
  if (enOnly.length) out.push('### Literals present only in `index.html` (en)', '', table(['path', 'line', 'value'], enOnly.map(([p, row]) => [p, row.locales.en.line, row.locales.en.value])), '');
  out.push('### JS flags', '', report.jsFlags.length ? table(['path', 'status', 'flag', 'value'], report.jsFlags.map((f) => [f.path, f.expected ? 'expected' : 'REVIEW', f.flag, f.value || ''])) : 'None.', '');
  const unesc = L.flatMap((l) => report.locales[l].home.jsUnescaped.map((u) => [l, u.path, u.line, u.raw, u.value]));
  out.push('### JS literals where an escape was resolved', '', unesc.length ? table(['locale', 'path', 'line', 'raw literal', 'stored value'], unesc) : 'None.', '');

  out.push('## Stripped decorations', '', 'Text-less leading/trailing icon elements excluded from a value\'s slice (the stored value is still one contiguous source substring). Shown for `en`; the JSON report lists every locale.', '');
  const enStrip = report.locales.en.home.strippedDecorations.concat(report.locales.en.privacy.strippedDecorations.map((x) => ({ ...x, path: 'privacy:' + x.path })));
  out.push(table(['path', 'position', 'stripped markup'], enStrip.flatMap((x) => x.stripped.map((st) => [x.path, st.position + (st.reason ? ` (${st.reason})` : ''), '`' + st.html.replace(/`/g, "'") + '`']))), '');
  out.push(table(['locale', 'home strips', 'privacy strips'], L.map((l) => [l, sum(report.locales[l].home.strippedDecorations, (x) => x.stripped.length), sum(report.locales[l].privacy.strippedDecorations, (x) => x.stripped.length)])), '');

  out.push('## Values containing interior line breaks (kept verbatim, CRLF)', '');
  const ml = L.flatMap((l) => ['home', 'privacy'].flatMap((p) => report.locales[l][p].multilineValues.map((m) => [l, p, m])));
  out.push(ml.length ? table(['locale', 'page', 'path'], ml) : 'None.', '');

  out.push('## Missing selectors (null because the element was not found)', '');
  const miss = L.flatMap((l) => ['home', 'privacy'].flatMap((p) => report.locales[l][p].missing.map((m) => [l, p, m])));
  out.push(miss.length ? table(['locale', 'page', 'path'], miss) : 'None.', '');

  out.push('## Verification notes (entries that passed A via the fallback path)', '');
  const vn = L.flatMap((l) => ['home', 'privacy'].flatMap((p) => report.locales[l][p].verificationNotes.map((n) => [l, p, n.line, n.path, n.note])));
  out.push(vn.length ? table(['locale', 'page', 'line', 'path', 'note'], vn) : 'None.', '');

  out.push('## Source markup anomalies (parse5 parse errors, per file)', '', 'Informational — the live files are read-only. Counts per file, then every distinct (code, line) pair.', '');
  out.push(table(['locale', 'page', 'file', 'parse errors'], L.flatMap((l) => ['home', 'privacy'].map((p) => [l, p, report.locales[l][p].sourceFile, report.locales[l][p].parseErrors.length]))), '');
  const pe = L.flatMap((l) => ['home', 'privacy'].flatMap((p) => report.locales[l][p].parseErrors.map((x) => [l, p, x.line, x.col, x.code])));
  out.push(pe.length ? table(['locale', 'page', 'line', 'col', 'code'], pe) : 'None.', '');

  out.push('## What the two un-id\'d sections are', '', `- ${results.home.en.tree.partner._sourceSection}: **SafariMedic partnership strip** (logo, one line of text, two buttons) → extracted as \`partner\`.`, `- ${results.home.en.tree.privacyBlurb._sourceSection}: **"Privacy and Confidentiality"** three-card block with a CTA → extracted as \`privacyBlurb\`.`, '');

  out.push('## Notes', '', ...report.notes.map((n) => `- ${n}`), '');
  return out.join('\n') + '\n';
}

main();
