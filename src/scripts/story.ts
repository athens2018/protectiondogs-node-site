import { track } from './consent';

// "Meet the dog" story modal — click-based navigation (dots, prev/next,
// arrow keys), focus trapped while open, focus returned on close, any other
// playing video paused while it is up. Labels come from data attributes so
// every locale's own wording is used.
export function initStory(): void {
  const modals = Array.from(document.querySelectorAll<HTMLElement>('.story-modal'));
  if (!modals.length) return;

  modals.forEach((modal) => {
    const slides = Array.from(modal.querySelectorAll<HTMLElement>('.story-slide'));
    const dots = Array.from(modal.querySelectorAll<HTMLElement>('.story-dot'));
    const prevBtn = modal.querySelector<HTMLButtonElement>('[data-story-prev]');
    const nextBtn = modal.querySelector<HTMLButtonElement>('[data-story-next]');
    const slidesWrap = modal.querySelector<HTMLElement>('.story-slides');
    const image = modal.querySelector<HTMLImageElement>('.story-photo img');
    const video = modal.querySelector<HTMLVideoElement>('.story-photo video');
    const nextLabel = nextBtn?.dataset.labelNext || nextBtn?.textContent?.trim() || '';
    const closeLabel = nextBtn?.dataset.labelClose || modal.querySelector('button[data-story-close]')?.getAttribute('aria-label') || '';
    let current = 0;
    let returnFocusEl: HTMLElement | null = null;
    let pausedOnOpen: HTMLVideoElement[] = [];

    function syncMedia() {
      const active = slides[current];
      const imageSrc = active?.dataset.storyImage;
      const videoSrc = active?.dataset.storyVideo;
      if (video && videoSrc) {
        if (image) image.hidden = true;
        video.hidden = false;
        if (imageSrc) video.setAttribute('poster', imageSrc);
        const source = video.querySelector('source');
        if (source && source.getAttribute('src') !== videoSrc) {
          source.setAttribute('src', videoSrc);
          video.load();
        }
        const start = () => video.play().catch(() => {});
        if (video.readyState >= 2) start();
        else video.addEventListener('loadeddata', start, { once: true });
      } else {
        if (video) {
          video.pause();
          video.hidden = true;
        }
        if (image) {
          image.hidden = false;
          if (imageSrc && image.getAttribute('src') !== imageSrc) image.setAttribute('src', imageSrc);
        }
      }
    }

    function show(index: number) {
      current = Math.max(0, Math.min(index, slides.length - 1));
      slides.forEach((s, i) => {
        s.classList.toggle('active', i === current);
        s.hidden = i !== current;
      });
      dots.forEach((d, i) => {
        d.classList.toggle('active', i === current);
        d.setAttribute('aria-current', i === current ? 'step' : 'false');
      });
      prevBtn?.classList.toggle('visible', current > 0);
      if (nextBtn) nextBtn.textContent = current === slides.length - 1 ? closeLabel : nextLabel;
      syncMedia();
    }

    function open(trigger: HTMLElement) {
      if (modal.classList.contains('open')) return;
      returnFocusEl = trigger;
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      pausedOnOpen = [];
      document.querySelectorAll('video').forEach((v) => {
        if (!modal.contains(v) && !v.paused && !v.ended) {
          v.pause();
          pausedOnOpen.push(v);
        }
      });
      show(0);
      modal.querySelector<HTMLButtonElement>('button[data-story-close]')?.focus();
      track('bobo_story_open', { page_lang: document.documentElement.lang || '' });
    }

    function close() {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      video?.pause();
      pausedOnOpen.forEach((v) => v.play().catch(() => {}));
      pausedOnOpen = [];
      show(0);
      if (returnFocusEl) {
        let back: HTMLElement = returnFocusEl;
        if (!back.matches('button, a, [tabindex]')) {
          back = back.querySelector<HTMLElement>('button[data-story-open]') || back;
        }
        back.focus();
      }
    }

    document.querySelectorAll<HTMLElement>(`[data-story-open="${modal.id}"]`).forEach((trigger) => {
      trigger.addEventListener('click', () => open(trigger));
      if (trigger.getAttribute('role') === 'button') {
        trigger.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            trigger.click();
          }
        });
      }
    });

    modal.querySelectorAll<HTMLElement>('[data-story-close]').forEach((btn) => btn.addEventListener('click', close));
    dots.forEach((dot, i) => dot.addEventListener('click', () => show(i)));
    prevBtn?.addEventListener('click', () => show(current - 1));
    nextBtn?.addEventListener('click', () => {
      if (current === slides.length - 1) close();
      else show(current + 1);
    });

    document.addEventListener('keydown', (e) => {
      if (!modal.classList.contains('open')) return;
      const rtl = document.documentElement.dir === 'rtl';
      if (e.key === 'Escape') close();
      else if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) show(current + 1);
      else if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) show(current - 1);
      else if (e.key === 'Tab') {
        const focusables = Array.from(
          modal.querySelectorAll<HTMLElement>('button, [href], video[controls], [tabindex]:not([tabindex="-1"])'),
        ).filter((el) => el.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    if (slidesWrap) show(0);
  });
}
