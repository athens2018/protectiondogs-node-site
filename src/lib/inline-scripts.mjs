import { createHash } from 'node:crypto';
import { LOCALES, DEFAULT_LOCALE, localeUrl, localePath } from './i18n.ts';

// The only inline scripts on the site. Each is generated here as an exact
// string so the component that renders it and the CSP that hashes it can
// never disagree. Everything else ships as bundled, same-origin modules.

/** Adds html.pdg-anim unless the visitor asked for reduced motion; entrance
    animations exist only under that class, so no script means no hiding. */
export function animOptInScript() {
  return "if(!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)){document.documentElement.classList.add('pdg-anim');}";
}

/** Bare root only: honour a previously EXPLICIT language choice. */
export function langRedirectScript(subpath = '') {
  const targets = Object.fromEntries(
    LOCALES.filter((l) => l.code !== DEFAULT_LOCALE).map((l) => [l.prefCode, localeUrl(l.code, subpath)]),
  );
  return (
    "(function(){try{var pref=localStorage.getItem('pdg-lang-pref');var targets=" +
    JSON.stringify(targets) +
    ';if(pref&&targets[pref]){window.location.replace(targets[pref]);}}catch(e){}})();'
  );
}

/** English homepage only: decide before first paint whether to suggest the
    visitor's browser language, and reserve the banner's height. */
export function langSuggestScript(localeCode = DEFAULT_LOCALE, subpath = '') {
  const others = LOCALES.filter((l) => l.code !== localeCode);
  const names = Object.fromEntries(others.map((l) => [l.code, l.nativeName]));
  const urls = Object.fromEntries(others.map((l) => [l.code, localePath(l.code, subpath)]));
  return (
    "(function(){try{var pref=localStorage.getItem('pdg-lang-pref');var dismissed=localStorage.getItem('pdg-lang-suggest-dismissed')==='true';if(pref||dismissed){return;}var names=" +
    JSON.stringify(names) +
    ';var urls=' +
    JSON.stringify(urls) +
    ";var langs=navigator.languages||[navigator.language||''];var code=null;for(var i=0;i<langs.length;i++){var c=(langs[i]||'').split('-')[0].toLowerCase();if(names[c]){code=c;break;}}if(!code){return;}var banner=document.getElementById('langSuggestBanner');if(!banner){return;}document.getElementById('langSuggestName').textContent=names[code];var link=document.getElementById('langSuggestSwitch');link.href=urls[code];link.setAttribute('data-lang-code',code);banner.hidden=false;document.documentElement.style.setProperty('--banner-h',(window.innerWidth<=576?44:38)+'px');}catch(e){}})();"
  );
}

function sha256(text) {
  return 'sha256-' + createHash('sha256').update(text, 'utf8').digest('base64');
}

/** Every inline script variant that can appear on any page, hashed for the CSP. */
export function inlineScriptHashes() {
  return [animOptInScript(), langRedirectScript(''), langSuggestScript(DEFAULT_LOCALE, '')].map(sha256);
}
