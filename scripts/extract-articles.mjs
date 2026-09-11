#!/usr/bin/env node
/**
 * Programmatic copy extraction for the four standalone English article pages
 * that stay indexed after the Astro cutover ("option A": kept off-nav, reached
 * by direct URL / search, rebuilt in the new visual system with copy verbatim).
 *
 * Reads (READ-ONLY, one level above node-site):
 *   ../breeding-science.html          → src/i18n/articles/breeding-science.json
 *   ../training-methodology.html      → src/i18n/articles/training-methodology.json
 *   ../comparative-analysis.html      → src/i18n/articles/comparative-analysis.json
 *   ../safarimedic-partnership.html   → src/i18n/articles/safarimedic-partnership.json
 * and writes scripts/reports/articles-report.md (+ .json).
 *
 * Byte-exactness rules are the same as scripts/extract-content.mjs (whose
 * helpers are duplicated here in minimal form because that script is not a
 * module — it runs its own main() on import):
 *   - every HTML value is a slice of the ORIGINAL source string
 *     (startTag.endOffset .. endTag.startOffset), trimmed of leading /
 *     trailing whitespace only. Entities are never decoded, inline markup is
 *     kept, nothing is reworded or normalised.
 *   - attribute values are parse5's parsed attribute value.
 *   - JSON-LD blocks are JSON.parse'd verbatim, in DOM order.
 *
 * Page shape (documented in the report, see "Block union"):
 *   page.cards[]        one entry per <div class="feature-card"> in DOM order
 *   page.cards[].blocks discriminated union on `tag`
 *   page.image          the FIRST <picture>/<img> found in any card, hoisted
 *                       as the hero (never also emitted as a block)
 *   page.ctas[]         every <a class="btn"> outside the cards (in DOM order)
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
const OUT_DIR = resolve(NODE_SITE, 'src', 'i18n', 'articles');
const OUT_REPORTS = resolve(__dirname, 'reports');

const SLUGS = ['breeding-science', 'training-methodology', 'comparative-analysis', 'safarimedic-partnership'];

/* ------------------------------------------------------------------ */
/* Tiny DOM helpers over the parse5 tree                              */
/* ------------------------------------------------------------------ */
const isEl = (n) => !!n && !!n.tagName;
const children = (n) => (n && n.childNodes ? n.childNodes.filter(isEl) : []);
const attr = (el, name) => {
  const a = el && el.attrs ? el.attrs.find((x) => x.name === name) : null;
  return a ? a.value : null;
};
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

/* ------------------------------------------------------------------ */
/* Minimal CSS-ish selector engine (tag, #id, .class, [attr op value]) */
/* with descendant (space) and child (>) combinators.                 */
/* ------------------------------------------------------------------ */
function parseCompound(str) {
  const c = { tag: null, id: null, classes: [], attrs: [] };
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
    if (ch === '[') depth++;
    if (ch === ']') depth--;
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
/* Extraction primitives (Ex leaves carry provenance; finalize() turns */
/* the tree into plain JSON and records one report entry per leaf).    */
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

function makeContext(src, doc) {
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
    /** raw innerHTML slice (leading/trailing text-less icon elements excluded) */
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
        end = start;
      }
      const raw = src.slice(start, end);
      return new Ex({ kind: 'html', value: raw.trim(), start, end, line: lineOf(start), node: el, stripped, ...extra });
    },
    /** parsed attribute value; null (not a mismatch) when the attribute is absent */
    at(el, name) {
      if (!el) return new Ex({ kind: 'attr', attr: name, value: null, missing: true });
      const v = attr(el, name);
      if (v === null) return new Ex({ kind: 'attr', attr: name, value: null, absent: true, node: el, line: lineOf(el.sourceCodeLocation.startOffset) });
      const aloc = el.sourceCodeLocation.attrs && el.sourceCodeLocation.attrs[name];
      return new Ex({ kind: 'attr', attr: name, value: v, start: aloc ? aloc.startOffset : null, end: aloc ? aloc.endOffset : null, line: lineOf(aloc ? aloc.startOffset : el.sourceCodeLocation.startOffset), node: el });
    },
    /** attribute of an optional element: null (not a mismatch) when the element is absent */
    atOpt(el, name) {
      return el ? X.at(el, name) : null;
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
  };
  return X;
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
/* Article mapping                                                    */
/* ------------------------------------------------------------------ */
const iconOf = (X, el) => {
  const i = query(el, 'i');
  return i ? X.at(i, 'class') : null;
};

/** <picture> (with its <source>s) or a bare <img> → image record */
function imageOf(X, el) {
  const img = el.tagName === 'img' ? el : query(el, 'img');
  const sources = el.tagName === 'picture' ? children(el).filter((c) => c.tagName === 'source') : [];
  return {
    src: X.at(img, 'src'),
    alt: X.at(img, 'alt'),
    width: X.at(img, 'width'),
    height: X.at(img, 'height'),
    /** the source's inline style attribute, kept verbatim (only the SafariMedic logo has one) */
    style: X.at(img, 'style'),
    sources: sources.map((s) => ({ srcset: X.at(s, 'srcset'), type: X.at(s, 'type') })),
  };
}

const linkOf = (X, a) => ({ label: X.html(a), href: X.at(a, 'href'), target: X.at(a, 'target'), rel: X.at(a, 'rel') });

/**
 * Ordered content blocks of one .feature-card. Discriminated union on `tag`:
 *   { tag: 'h2' | 'h3' | 'h4', html }
 *   { tag: 'p', html, class }            class = the source class attribute or null
 *   { tag: 'ul' | 'ol', items: [html] }
 *   { tag: 'blockquote', html }
 *   { tag: 'image', ...imageOf }         a <picture>/<img> that is NOT the hoisted hero
 *   { tag: 'a', label, href, target, rel }
 *   { tag: <other>, html, unexpected: true }   never expected; flagged in the report
 * Nested <div>s are flattened. <hr>/<br> and text-less <i>/<svg> are skipped.
 */
function blocksOf(X, container, ctx, out = []) {
  for (const c of children(container)) {
    const t = c.tagName;
    if (t === 'div' || t === 'section') blocksOf(X, c, ctx, out);
    else if (t === 'ul' || t === 'ol') out.push({ tag: t, items: children(c).filter((li) => li.tagName === 'li').map((li) => X.html(li)) });
    else if (/^h[2-6]$/.test(t)) out.push({ tag: t, html: X.html(c) });
    else if (t === 'p') out.push({ tag: 'p', html: X.html(c), class: X.at(c, 'class') });
    else if (t === 'blockquote') out.push({ tag: t, html: X.html(c) });
    else if (t === 'picture' || t === 'img') {
      if (!ctx.hero) {
        ctx.hero = imageOf(X, c);
        ctx.heroLine = X.lineOf(c.sourceCodeLocation.startOffset);
      } else out.push({ tag: 'image', ...imageOf(X, c) });
    } else if (t === 'a' || t === 'button') out.push({ tag: 'a', ...linkOf(X, c) });
    else if (['hr', 'br', 'i', 'svg'].includes(t)) continue;
    else out.push({ tag: t, html: X.html(c), unexpected: true });
  }
  return out;
}

function extractArticle(X) {
  const doc = X.doc;
  const $ = (s, r = doc) => query(r, s);
  const $$ = (s, r = doc) => queryAll(r, s);
  const head = $('head');
  const body = $('body');
  const main = $('main');

  /* meta ---------------------------------------------------------- */
  const meta = {
    title: X.html($('title', head)),
    description: X.at($('meta[name=description]', head), 'content'),
    robots: X.at($('meta[name=robots]', head), 'content'),
    canonical: X.at($('link[rel=canonical]', head), 'href'),
    ogTitle: X.at($('meta[property="og:title"]', head), 'content'),
    ogDescription: X.at($('meta[property="og:description"]', head), 'content'),
    ogType: X.at($('meta[property="og:type"]', head), 'content'),
    ogUrl: X.at($('meta[property="og:url"]', head), 'content'),
    ogImage: X.at($('meta[property="og:image"]', head), 'content'),
    twitterCard: X.at($('meta[name="twitter:card"]', head), 'content'),
    /** every <script type="application/ld+json"> in <head>, DOM order, parsed verbatim */
    jsonld: $$('script[type="application/ld+json"]', head).map((s) => X.jsonld(s)),
  };

  /* nav ----------------------------------------------------------- */
  const navEl = $('nav.navbar', body);
  const nav = {
    ariaLabel: X.at(navEl, 'aria-label'),
    brand: { href: X.at($('a.navbar-brand', navEl), 'href'), alt: X.at($('a.navbar-brand img', navEl), 'alt') },
    toggleAriaLabel: X.at($('button.navbar-toggler', navEl), 'aria-label'),
    items: $$('#navbarNav a.nav-link', navEl).map((a) => ({ label: X.html(a), href: X.at(a, 'href') })),
  };

  /* breadcrumb ---------------------------------------------------- */
  const bc = $('nav[aria-label=breadcrumb]', body);
  const breadcrumb = {
    ariaLabel: X.at(bc, 'aria-label'),
    items: $$('li.breadcrumb-item', bc).map((li) => ({ label: X.html($('span[itemprop=name]', li)), href: query(li, 'a') ? X.at(query(li, 'a'), 'href') : null })),
  };

  /* page ---------------------------------------------------------- */
  const ctx = { hero: null, heroLine: null };
  const cardEls = $$('.feature-card', main);
  const cards = cardEls.map((card) => ({ blocks: blocksOf(X, card, ctx) }));
  const ctaEls = $$('a.btn', main).filter((a) => !cardEls.some((card) => [...walk(card)].includes(a)));
  const page = {
    eyebrow: X.html($('p.eyebrow', main)),
    h1: X.html($('h1', main)),
    image: ctx.hero,
    cards,
    ctas: ctaEls.map((a) => linkOf(X, a)),
  };

  /* cookie -------------------------------------------------------- */
  const cookieEl = $('#cookieConsent', body);
  const cookie = {
    ariaLabel: X.at(cookieEl, 'aria-label'),
    text: X.html($('.cookie-consent-text', cookieEl)),
    reject: X.html($('#cookieReject', cookieEl)),
    accept: X.html($('#cookieAccept', cookieEl)),
  };

  /* footer -------------------------------------------------------- */
  const ft = $('footer', body);
  const cols = $$('.row.g-4 > .col-md-4', ft);
  const heading = (col) => children(col).find((c) => /^h[1-6]$/.test(c.tagName));
  const langList = $('.footer-lang-list', ft);
  const footer = {
    brand: { h3: X.html(heading(cols[0])), text: X.html($('p', cols[0])) },
    quickLinks: {
      h3: X.html(heading(cols[1])),
      ariaLabel: X.at($('nav', cols[1]), 'aria-label'),
      links: $$('li a', cols[1]).map((a) => ({ label: X.html(a), href: X.at(a, 'href') })),
    },
    language: langList ? { present: true } : null,
    connect: {
      h3: X.html(heading(cols[2])),
      links: $$('.social-links a', cols[2]).map((a) => ({ href: X.at(a, 'href'), ariaLabel: X.at(a, 'aria-label'), icon: iconOf(X, a) })),
    },
    copyright: X.html($('.row.mt-5 p', ft)),
  };

  /* a11y ---------------------------------------------------------- */
  const skip = $('a.skip-link', body);
  const a11y = { skipLink: { label: X.html(skip), href: X.at(skip, 'href') } };

  const observations = {
    heroSourceLine: ctx.heroLine,
    footerHeadingTags: cols.map((c) => (heading(c) ? heading(c).tagName : null)),
    footerLanguageColumn: !!langList,
    cookieBanner: !!cookieEl,
    mainColumnClass: attr(children($('.row', main))[0], 'class'),
  };

  return { tree: { meta, nav, breadcrumb, page, cookie, footer, a11y }, observations };
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
      // verbatim substring: the trimmed slice equals the value AND the value is found at exactly that offset
      a = raw.trim() === e.value && src.indexOf(e.value, e.start) === e.start + (raw.length - raw.trimStart().length);
    } else if (e.kind === 'attr') {
      const raw = src.slice(e.start, e.end);
      const probe = parseFragment(`<x ${raw}>`);
      const el = probe.childNodes[0];
      a = !!el && attr(el, e.attr) === e.value;
    } else if (e.kind === 'jsonld') {
      try {
        a = JSON.stringify(JSON.parse(src.slice(e.start, e.end))) === JSON.stringify(e.value);
      } catch {
        a = false;
      }
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

function coverage(doc, entries) {
  const body = query(doc, 'body');
  const ranges = entries.filter((e) => e.kind === 'html' && e.value !== null).map((e) => [e.start, e.end]);
  let total = 0;
  let covered = 0;
  const uncovered = [];
  for (const t of bodyTextNodes(body)) {
    const text = collapse(t.value);
    if (!text) continue;
    total++;
    const l = t.sourceCodeLocation;
    if (ranges.some(([s, e]) => s <= l.startOffset && l.endOffset <= e)) covered++;
    else uncovered.push({ line: l.startLine, text: text.length > 120 ? text.slice(0, 117) + '...' : text });
  }
  return { total, covered, pct: total ? +((covered / total) * 100).toFixed(2) : 100, uncovered };
}

const sum = (arr, f) => arr.reduce((n, x) => n + f(x), 0);
function inventory(t) {
  const blocks = t.page.cards.flatMap((c) => c.blocks);
  const count = (tag) => blocks.filter((b) => b.tag === tag).length;
  return {
    cards: t.page.cards.length,
    blocks: blocks.length,
    h2: count('h2'),
    h3: count('h3'),
    p: count('p'),
    pWithClass: blocks.filter((b) => b.tag === 'p' && b.class).length,
    lists: count('ul') + count('ol'),
    listItems: sum(blocks.filter((b) => b.items), (b) => b.items.length),
    blockquotes: count('blockquote'),
    inlineImages: count('image'),
    inlineLinks: count('a'),
    unexpected: blocks.filter((b) => b.unexpected).length,
    heroImage: t.page.image ? 1 : 0,
    heroSources: t.page.image ? t.page.image.sources.length : 0,
    ctas: t.page.ctas.length,
    externalCtas: t.page.ctas.filter((c) => c.target).length,
    jsonld: t.meta.jsonld.map((b) => (b && b['@type']) || 'invalid').join('+') || '(none)',
    navItems: t.nav.items.length,
    footerQuickLinks: t.footer.quickLinks.links.length,
    footerConnect: t.footer.connect.links.length,
  };
}

/* ------------------------------------------------------------------ */
/* Main                                                               */
/* ------------------------------------------------------------------ */
function processArticle(slug) {
  const file = `${slug}.html`;
  const src = readFileSync(resolve(SITE_ROOT, file), 'utf8');
  const parseErrors = [];
  const doc = parse(src, { sourceCodeLocationInfo: true, onParseError: (e) => parseErrors.push({ code: e.code, line: e.startLine, col: e.startCol }) });
  const X = makeContext(src, doc);
  const { tree: raw, observations } = extractArticle(X);
  const entries = [];
  const tree = finalize(raw, '', entries);
  const { A, B } = verifyEntries(src, entries);
  const cov = coverage(doc, entries);
  const missing = entries.filter((e) => e.missing).map((e) => e.path);
  const stripped = entries.filter((e) => e.stripped && e.stripped.length).map((e) => ({ path: e.path, stripped: e.stripped }));
  const multiline = entries.filter((e) => e.kind === 'html' && e.value && /[\r\n]/.test(e.value)).map((e) => e.path);
  const unexpected = tree.page.cards.flatMap((c, ci) => c.blocks.map((b, bi) => ({ b, path: `page.cards[${ci}].blocks[${bi}]` })).filter((x) => x.b.unexpected));
  const jsonldErrors = entries.filter((e) => e.kind === 'jsonld' && e.error).map((e) => ({ path: e.path, error: e.error }));
  const webPage = tree.meta.jsonld.find((b) => b && b['@type'] === 'WebPage');
  const jsonldUrlMatchesCanonical = webPage ? webPage.url === tree.meta.canonical : null;
  const counts = {
    entries: entries.length,
    html: entries.filter((e) => e.kind === 'html' && e.value !== null).length,
    attr: entries.filter((e) => e.kind === 'attr' && e.value !== null).length,
    jsonld: entries.filter((e) => e.kind === 'jsonld').length,
    nulls: entries.filter((e) => e.value === null).length,
  };
  const outFile = resolve(OUT_DIR, `${slug}.json`);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(outFile, JSON.stringify(tree, null, 2) + '\n', 'utf8');
  return {
    slug,
    file,
    srcBytes: Buffer.byteLength(src),
    outFile: relative(NODE_SITE, outFile).replace(/\\/g, '/'),
    outBytes: statSync(outFile).size,
    tree,
    A,
    B,
    cov,
    missing,
    stripped,
    multiline,
    unexpected,
    jsonldErrors,
    jsonldUrlMatchesCanonical,
    counts,
    parseErrors,
    observations,
    inventory: inventory(tree),
    entries: entries.map((e) => ({ path: e.path, kind: e.kind, line: e.line ?? null, start: e.start ?? null, end: e.end ?? null, a: e.a, b: e.b, ...(e.missing ? { missing: true } : {}) })),
  };
}

function main() {
  const results = SLUGS.map(processArticle);
  const notes = [];
  for (const r of results) {
    const o = r.observations;
    if (!o.cookieBanner) notes.push(`${r.file}: no #cookieConsent banner found (expected one).`);
    if (o.footerLanguageColumn) notes.push(`${r.file}: footer HAS a Language column (unexpected on article pages).`);
    if (o.footerHeadingTags.some((t) => t !== 'h3')) notes.push(`${r.file}: footer column headings are <${o.footerHeadingTags.join('>, <')}> rather than <h3> — extracted as footer.*.h3 regardless (the key names the slot, the new Footer component renders its own heading level).`);
    if (r.tree.page.cards.length !== 1) notes.push(`${r.file}: ${r.tree.page.cards.length} .feature-card blocks (not one) — kept as page.cards[] in DOM order; the page template renders them as consecutive prose groups.`);
    if (!r.tree.page.image) notes.push(`${r.file}: no <picture>/<img> inside any .feature-card — page.image is null.`);
    else if (r.tree.page.image.style) notes.push(`${r.file}: hero <img> carries an inline style attribute ("${r.tree.page.image.style}") — recorded as page.image.style verbatim.`);
    if (r.tree.page.ctas.some((c) => c.target)) notes.push(`${r.file}: CTA(s) with target/rel (external link) — recorded as ctas[].target / ctas[].rel.`);
    if (r.tree.meta.jsonld.length !== 1) notes.push(`${r.file}: ${r.tree.meta.jsonld.length} JSON-LD block(s) (${r.inventory.jsonld}).`);
    if (r.jsonldUrlMatchesCanonical === false) notes.push(`${r.file}: JSON-LD WebPage.url differs from <link rel=canonical>.`);
    const pWithClass = r.tree.page.cards.flatMap((c) => c.blocks).filter((b) => b.tag === 'p' && b.class).map((b) => b.class);
    if (pWithClass.length) notes.push(`${r.file}: ${pWithClass.length} <p> block(s) carry a class attribute (${[...new Set(pWithClass)].map((c) => `"${c}"`).join(', ')}) — recorded as blocks[].class so the template can style them (phase timing lines).`);
    const privacyLink = r.tree.footer.quickLinks.links.find((l) => /privacy-policy\.html$/.test(l.href));
    if (privacyLink) notes.push(`${r.file}: footer quick link "${privacyLink.label}" points at ${privacyLink.href} (the old physical file, now a 301); kept verbatim in JSON.`);
  }
  notes.push('meta.canonical / meta.ogUrl / JSON-LD WebPage.url are the OLD .html URLs, kept as extracted; the page template computes the new clean canonical itself and rewrites only the JSON-LD url at render time.');
  notes.push('meta.ogImage is the absolute live URL as extracted; the template derives the root-relative path because Base.astro prepends SITE_ORIGIN.');

  const report = {
    generatedBy: relative(NODE_SITE, fileURLToPath(import.meta.url)).replace(/\\/g, '/'),
    articles: Object.fromEntries(results.map((r) => [r.slug, { sourceFile: r.file, sourceBytes: r.srcBytes, outputFile: r.outFile, outputBytes: r.outBytes, counts: r.counts, checkA: r.A, checkB: r.B, coverage: r.cov, inventory: r.inventory, observations: r.observations, missing: r.missing, strippedDecorations: r.stripped, multilineValues: r.multiline, unexpectedBlocks: r.unexpected, jsonldErrors: r.jsonldErrors, jsonldUrlMatchesCanonical: r.jsonldUrlMatchesCanonical, parseErrors: r.parseErrors, entries: r.entries }])),
    notes,
  };
  const totA = { pass: sum(results, (r) => r.A.pass), fail: sum(results, (r) => r.A.fail) };
  const totB = { pass: sum(results, (r) => r.B.pass), fail: sum(results, (r) => r.B.fail) };
  const totCov = { total: sum(results, (r) => r.cov.total), covered: sum(results, (r) => r.cov.covered) };
  report.summary = { files: results.length, checkA: totA, checkB: totB, coverage: { ...totCov, pct: +((totCov.covered / totCov.total) * 100).toFixed(2) }, unexpectedBlocks: sum(results, (r) => r.unexpected.length), missing: sum(results, (r) => r.missing.length) };

  mkdirSync(OUT_REPORTS, { recursive: true });
  writeFileSync(resolve(OUT_REPORTS, 'articles-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  writeFileSync(resolve(OUT_REPORTS, 'articles-report.md'), renderMarkdown(report, results), 'utf8');

  console.log(`A: ${totA.pass} pass / ${totA.fail} fail   B: ${totB.pass} pass / ${totB.fail} fail   C: ${report.summary.coverage.pct}% (${totCov.covered}/${totCov.total})   unexpected blocks: ${report.summary.unexpectedBlocks}   missing: ${report.summary.missing}`);
  for (const r of results) console.log(`${r.slug.padEnd(24)} ${String(r.entries.length).padStart(4)} entries, C ${r.cov.pct}% (${r.cov.uncovered.length} uncovered), cards ${r.inventory.cards}, blocks ${r.inventory.blocks}, hero ${r.inventory.heroImage}, ctas ${r.inventory.ctas}, jsonld ${r.inventory.jsonld}`);
  if (totA.fail || totB.fail || report.summary.unexpectedBlocks || report.summary.missing || totCov.covered !== totCov.total) process.exitCode = 1;
}

/* ------------------------------------------------------------------ */
/* Markdown report                                                    */
/* ------------------------------------------------------------------ */
function table(header, rows) {
  const esc = (v) => String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  return [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
}
function renderMarkdown(report, results) {
  const out = [];
  const s = report.summary;
  out.push('# Article extraction report', '', `Generated by \`${report.generatedBy}\` (deterministic; re-run with \`npm run extract:articles\`). Sources: the four standalone English article pages in the site root (read-only). Outputs: \`src/i18n/articles/<slug>.json\`.`, '');
  out.push('## Summary', '');
  out.push(table(['metric', 'value'], [
    ['files parsed', s.files],
    ['A. verbatim-substring check', `${s.checkA.pass} pass / ${s.checkA.fail} fail`],
    ['B. text-content check', `${s.checkB.pass} pass / ${s.checkB.fail} fail`],
    ['C. body text-node coverage', `${s.coverage.covered} / ${s.coverage.total} (${s.coverage.pct}%)`],
    ['unexpected block tags', s.unexpectedBlocks],
    ['missing selectors', s.missing],
  ]), '');

  out.push('## Block union (`page.cards[].blocks[]`)', '', 'One `cards[]` entry per `<div class="feature-card">` in DOM order (the four sources have between 1 and 7). Inside a card, blocks are a discriminated union on `tag`:', '',
    '| tag | fields | meaning |', '| --- | --- | --- |',
    '| `h2` / `h3` / `h4` | `html` | heading innerHTML |',
    '| `p` | `html`, `class` | paragraph innerHTML; `class` is the source class attribute or `null` (the phase timing lines carry `text-light opacity-75 mb-3`) |',
    '| `ul` / `ol` | `items[]` | list, one innerHTML per `<li>` |',
    '| `blockquote` | `html` | (supported, none present) |',
    '| `image` | `src`, `alt`, `width`, `height`, `style`, `sources[]` | a `<picture>`/`<img>` other than the first one (supported, none present — the first is hoisted to `page.image`) |',
    '| `a` | `label`, `href`, `target`, `rel` | a link/button inside a card (supported, none present) |',
    '| anything else | `html`, `unexpected: true` | flagged below |',
    '', '`page.image` is the first `<picture>`/`<img>` inside any card (all three that have one place it first in card 0). `page.ctas[]` are the `<a class="btn">` elements in `<main>` outside every card. Absent optional attributes (`target`, `rel`, `style`, `class`) are `null`.', '');

  out.push('## A / B — verbatim-substring and text-content checks', '', 'A: every HTML value equals the trimmed source slice at its recorded offsets and is found verbatim at that offset; attribute values re-parse from their raw attribute token; JSON-LD blocks re-parse identically. B: the extracted fragment, parsed with parse5 and whitespace-collapsed, has the same text as the source node range (HTML entries only).', '');
  out.push(table(['article', 'entries', 'A pass', 'A fail', 'A n/a', 'B pass', 'B fail', 'B n/a'], results.map((r) => [r.slug, r.entries.length, r.A.pass, r.A.fail, r.A.na, r.B.pass, r.B.fail, r.B.na])), '');
  const failures = results.flatMap((r) => [...r.A.failures.map((f) => [r.slug, 'A', f.path, f.line]), ...r.B.failures.map((f) => [r.slug, 'B', f.path, f.line])]);
  out.push(failures.length ? table(['article', 'check', 'path', 'line'], failures) : 'No A/B failures.', '');
  out.push('n/a entries are null values (absent optional attributes such as `target`/`rel` on internal CTAs, `style` on ordinary images, `class` on plain paragraphs, `href` on the current breadcrumb item, `page.image` where the article has no image).', '');

  out.push('## C — coverage of body text nodes', '', 'Every non-whitespace text node under `<body>` (scripts/styles excluded) must fall inside the source range of at least one extracted HTML value.', '');
  out.push(table(['article', 'text nodes', 'covered', '%', 'uncovered'], results.map((r) => [r.slug, r.cov.total, r.cov.covered, r.cov.pct, r.cov.uncovered.length])), '');
  const unc = results.flatMap((r) => r.cov.uncovered.map((u) => [r.slug, u.line, u.text]));
  out.push(unc.length ? table(['article', 'line', 'text'], unc) : 'No uncovered text nodes.', '');

  out.push('## Per-page inventory', '');
  const keys = Object.keys(results[0].inventory);
  out.push(table(['count', ...results.map((r) => r.slug)], keys.map((k) => [k, ...results.map((r) => r.inventory[k])])), '');

  out.push('## Structural observations', '');
  out.push(table(['article', 'main column', 'hero source line', 'footer heading tags', 'footer Language column', 'cookie banner', 'JSON-LD WebPage.url == canonical'], results.map((r) => [r.slug, r.observations.mainColumnClass, r.observations.heroSourceLine ?? '—', r.observations.footerHeadingTags.join(', '), r.observations.footerLanguageColumn ? 'yes' : 'no', r.observations.cookieBanner ? 'yes' : 'no', r.jsonldUrlMatchesCanonical === null ? 'n/a (no WebPage block)' : r.jsonldUrlMatchesCanonical ? 'yes' : '**NO**'])), '');

  out.push('## Unexpected blocks', '');
  const ub = results.flatMap((r) => r.unexpected.map((u) => [r.slug, u.path, u.b.tag]));
  out.push(ub.length ? table(['article', 'path', 'tag'], ub) : 'None.', '');

  out.push('## Missing selectors (null because the element was not found)', '');
  const miss = results.flatMap((r) => r.missing.map((m) => [r.slug, m]));
  out.push(miss.length ? table(['article', 'path'], miss) : 'None.', '');

  out.push('## Stripped decorations', '', 'Text-less leading/trailing icon elements excluded from a value\'s slice (the stored value is still one contiguous source substring).', '');
  const st = results.flatMap((r) => r.stripped.flatMap((x) => x.stripped.map((d) => [r.slug, x.path, d.position, '`' + d.html.replace(/`/g, "'") + '`'])));
  out.push(st.length ? table(['article', 'path', 'position', 'stripped markup'], st) : 'None.', '');

  out.push('## Values containing interior line breaks (kept verbatim)', '');
  const ml = results.flatMap((r) => r.multiline.map((m) => [r.slug, m]));
  out.push(ml.length ? table(['article', 'path'], ml) : 'None.', '');

  out.push('## JSON-LD', '');
  out.push(table(['article', 'blocks', 'parse errors'], results.map((r) => [r.slug, r.inventory.jsonld, r.jsonldErrors.length ? r.jsonldErrors.map((e) => `${e.path}: ${e.error}`).join('; ') : 'none'])), '');

  out.push('## Totals', '');
  out.push(table(['article', 'source file', 'source bytes', 'output file', 'output bytes', 'leaf entries', 'html', 'attr', 'jsonld', 'null'], results.map((r) => [r.slug, r.file, r.srcBytes, r.outFile, r.outBytes, r.counts.entries, r.counts.html, r.counts.attr, r.counts.jsonld, r.counts.nulls])), '');

  out.push('## Source markup anomalies (parse5 parse errors, per file)', '', 'Informational — the live files are read-only.', '');
  const pe = results.flatMap((r) => r.parseErrors.map((x) => [r.slug, x.line, x.col, x.code]));
  out.push(pe.length ? table(['article', 'line', 'col', 'code'], pe) : 'None.', '');

  out.push('## Notes', '', ...report.notes.map((n) => `- ${n}`), '');
  return out.join('\n') + '\n';
}

main();
