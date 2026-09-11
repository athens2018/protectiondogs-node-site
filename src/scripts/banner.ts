// Language-suggestion banner: a dismissible SUGGESTION only, never an
// automatic redirect. Whether it shows is decided by a tiny inline script
// before first paint (see Header.astro); this module only wires behaviour.
export function initBanner(): void {
  const banner = document.getElementById('langSuggestBanner');
  if (!banner) return;

  const layout = () => {
    const visible = !banner.hidden && !banner.classList.contains('dismissed');
    banner.style.top = '0px';
    document.documentElement.style.setProperty('--banner-h', (visible ? banner.offsetHeight : 0) + 'px');
  };
  layout();
  window.addEventListener('resize', layout);

  const switchLink = document.getElementById('langSuggestSwitch');
  switchLink?.addEventListener('click', () => {
    if (window.location.hash) {
      const base = (switchLink.getAttribute('href') || '').split('#')[0];
      switchLink.setAttribute('href', base + window.location.hash);
    }
    try {
      localStorage.setItem('pdg-lang-pref', switchLink.getAttribute('data-lang-code') || '');
    } catch {
      /* ignore */
    }
  });

  banner.querySelector('.lang-suggest-dismiss')?.addEventListener('click', () => {
    banner.hidden = true;
    layout();
    try {
      localStorage.setItem('pdg-lang-suggest-dismissed', 'true');
    } catch {
      /* ignore */
    }
  });
}
