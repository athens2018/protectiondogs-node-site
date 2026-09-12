import { track } from './consent';

// Minimum horizontal drag, in CSS pixels, before a touch gesture counts as
// a deliberate swipe rather than an incidental finger wobble.
const SWIPE_THRESHOLD_PX = 40;

// Slide-change animation: the outgoing slide shifts/fades out, then the
// incoming one enters from the opposite side — direction-aware (RTL
// mirrors it, same as the arrow keys/swipe above), gated on html.pdg-anim
// (src/lib/inline-scripts.mjs's own reduced-motion opt-in, reused as-is
// rather than a second matchMedia check). SLIDE_TRANSITION_MS must match
// .story-slide's own CSS transition-duration below — they're two halves
// of one animation, not independently tunable.
const SLIDE_TRANSITION_MS = 160;
const SLIDE_OFFSET_PX = 28;

// "Meet the dog" story modal — click-based navigation (dots, prev/next,
// arrow keys), touch-swipe navigation (left/right, RTL-aware, same as the
// arrow keys below), focus trapped while open, focus returned on close,
// any other playing video paused while it is up. Labels come from data
// attributes so every locale's own wording is used.
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

    // Explicit `number` (not ReturnType<typeof window.setTimeout>): with
    // both DOM and Node types in scope, TS can otherwise infer window.
    // setTimeout's return as Node's Timeout instead of the browser's own
    // numeric handle.
    let pendingSlideTimeout: number | null = null;

    // Resets every slide to its final (non-transitioning) state for
    // whichever one is now current — the shared end-state both the
    // no-animation path and the animated path's delayed step settle into,
    // so there's exactly one place that defines "settled," not two copies
    // that could drift apart.
    function settleSlides() {
      slides.forEach((s, i) => {
        s.classList.toggle('active', i === current);
        s.hidden = i !== current;
        s.style.transition = '';
        s.style.transform = '';
        s.style.opacity = '';
      });
    }

    function show(index: number) {
      const previousIndex = current;
      current = Math.max(0, Math.min(index, slides.length - 1));

      // A rapid second tap/swipe while the first transition is still
      // mid-flight fast-forwards the pending one instantly rather than
      // leaving two overlapping animations to fight over the same
      // elements' inline styles.
      if (pendingSlideTimeout !== null) {
        window.clearTimeout(pendingSlideTimeout);
        pendingSlideTimeout = null;
        settleSlides();
      }

      dots.forEach((d, i) => {
        d.classList.toggle('active', i === current);
        d.setAttribute('aria-current', i === current ? 'step' : 'false');
      });
      prevBtn?.classList.toggle('visible', current > 0);
      if (nextBtn) nextBtn.textContent = current === slides.length - 1 ? closeLabel : nextLabel;
      syncMedia();

      const outgoing = slides[previousIndex];
      const incoming = slides[current];
      const canAnimate = document.documentElement.classList.contains('pdg-anim') && outgoing && incoming && outgoing !== incoming;
      if (!canAnimate) {
        settleSlides();
        return;
      }

      const rtl = document.documentElement.dir === 'rtl';
      const forward = current > previousIndex;
      const offset = (forward ? -1 : 1) * (rtl ? -1 : 1) * SLIDE_OFFSET_PX;

      outgoing.style.transform = `translateX(${offset}px)`;
      outgoing.style.opacity = '0';

      pendingSlideTimeout = window.setTimeout(() => {
        pendingSlideTimeout = null;
        outgoing.classList.remove('active');
        outgoing.hidden = true;
        outgoing.style.transition = '';
        outgoing.style.transform = '';
        outgoing.style.opacity = '';

        incoming.classList.add('active');
        incoming.hidden = false;
        incoming.style.transition = 'none';
        incoming.style.transform = `translateX(${-offset}px)`;
        incoming.style.opacity = '0';
        void incoming.offsetWidth; // force layout so the "from" state above actually applies before transitioning
        incoming.style.transition = '';
        incoming.style.transform = '';
        incoming.style.opacity = '';
      }, SLIDE_TRANSITION_MS);
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

    // Shared by the Next button and the swipe handler below, so "swipe past
    // the last slide" and "tap Next on the last slide" behave identically
    // (both close the modal) — the keyboard's forward arrow deliberately
    // doesn't (Escape is the dedicated close key there), but a touch
    // gesture has no separate close key, and swiping past the end to
    // dismiss is the expected feel on a phone (same as Stories-style UIs).
    function goNext() {
      if (current === slides.length - 1) close();
      else show(current + 1);
    }
    function goPrev() {
      show(current - 1);
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
    prevBtn?.addEventListener('click', goPrev);
    nextBtn?.addEventListener('click', goNext);

    // Touch swipe: a single-finger horizontal drag past the threshold, with
    // more horizontal than vertical movement (so a vertical scroll inside a
    // tall slide is never hijacked as a swipe). RTL mirrors the arrow keys'
    // own mapping above: "forward" is a leading-edge swipe either way.
    if (slidesWrap) {
      let touchStartX = 0;
      let touchStartY = 0;
      let tracking = false;

      slidesWrap.addEventListener(
        'touchstart',
        (e) => {
          if (e.touches.length !== 1) {
            tracking = false;
            return;
          }
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
          tracking = true;
        },
        { passive: true },
      );

      slidesWrap.addEventListener(
        'touchend',
        (e) => {
          if (!tracking) return;
          tracking = false;
          const touch = e.changedTouches[0];
          const dx = touch.clientX - touchStartX;
          const dy = touch.clientY - touchStartY;
          if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy)) return;
          const rtl = document.documentElement.dir === 'rtl';
          const swipedTowardStart = dx > 0; // finger moved rightward
          if (swipedTowardStart === rtl) goNext();
          else goPrev();
        },
        { passive: true },
      );
    }

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
