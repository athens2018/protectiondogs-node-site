// One rAF-throttled scroll listener drives the progress bar, the solid
// navbar state, the back-to-top button and the section-dot highlight.
export function initScroll(): void {
  const bar = document.getElementById('scrollProgressBar');
  const nav = document.querySelector<HTMLElement>('nav.navbar');
  const backToTop = document.getElementById('backToTopBtn');
  const dots = Array.from(document.querySelectorAll<HTMLAnchorElement>('.section-dot'));
  const dotSections = dots
    .map((dot) => document.getElementById(dot.dataset.section || ''))
    .filter((s): s is HTMLElement => !!s);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const handle = () => {
    const top = window.pageYOffset || document.documentElement.scrollTop;

    if (bar) {
      const doc = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      bar.style.width = (doc > 0 ? (top / doc) * 100 : 0) + '%';
    }

    nav?.classList.toggle('navbar-scrolled', top > 80);
    backToTop?.classList.toggle('visible', top > 500);

    if (dots.length && dotSections.length) {
      let current = dotSections[0];
      for (const section of dotSections) {
        if (top >= section.offsetTop - window.innerHeight / 2) current = section;
      }
      for (const dot of dots) {
        const on = dot.dataset.section === current.id;
        dot.classList.toggle('active', on);
        if (on) dot.setAttribute('aria-current', 'location');
        else dot.removeAttribute('aria-current');
      }
    }
  };

  let ticking = false;
  window.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        handle();
        ticking = false;
      });
    },
    { passive: true },
  );
  handle();

  backToTop?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  });
}
