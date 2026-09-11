// Language drawer — one shared drawer, two triggers (desktop inline trigger,
// mobile compact trigger next to the hamburger). Every option is a real
// <a href>, so switching works even if this never runs. On top of that:
// carry the current hash so /de/#dogs -> /fr/#dogs, and remember the choice
// as an EXPLICIT preference that the bare-root head script may act on later.
export function initLang(): void {
  const drawer = document.getElementById('langDrawer');
  const backdrop = document.getElementById('langDrawerBackdrop');
  const closeBtn = document.getElementById('langDrawerClose');
  const triggers = [document.getElementById('langTrigger'), document.getElementById('mobileLangTrigger')].filter(
    (t): t is HTMLElement => !!t,
  );

  if (drawer && triggers.length) {
    let openedBy: HTMLElement | null = null;
    const isOpen = () => drawer.classList.contains('open');
    const close = () => {
      drawer.classList.remove('open');
      backdrop?.classList.remove('open');
      document.body.classList.remove('lang-drawer-open');
      triggers.forEach((t) => t.setAttribute('aria-expanded', 'false'));
    };
    const open = (trigger: HTMLElement) => {
      openedBy = trigger;
      drawer.classList.add('open');
      backdrop?.classList.add('open');
      document.body.classList.add('lang-drawer-open');
      trigger.setAttribute('aria-expanded', 'true');
      const active = drawer.querySelector<HTMLElement>('.lang-option.is-active') || drawer.querySelector<HTMLElement>('.lang-option');
      window.setTimeout(() => active?.focus(), 40);
    };

    triggers.forEach((trigger) => {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isOpen()) close();
        else open(trigger);
      });
    });
    backdrop?.addEventListener('click', close);
    closeBtn?.addEventListener('click', () => {
      close();
      openedBy?.focus();
    });
    document.addEventListener('click', (e) => {
      const t = e.target as Node;
      if (isOpen() && !drawer.contains(t) && !triggers.some((tr) => tr.contains(t))) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) {
        close();
        openedBy?.focus();
      }
    });
  }

  document.querySelectorAll<HTMLAnchorElement>('.lang-option, .footer-lang').forEach((link) => {
    link.addEventListener('click', () => {
      if (window.location.hash) {
        const base = (link.getAttribute('href') || '').split('#')[0];
        link.setAttribute('href', base + window.location.hash);
      }
      try {
        localStorage.setItem('pdg-lang-pref', link.getAttribute('hreflang') || '');
      } catch {
        /* ignore */
      }
    });
  });
}
