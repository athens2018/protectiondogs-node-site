// Training timeline: the numbered timeline, the prev/next controls and the
// keyboard all call the same activatePhase(), so the panel, highlight, track
// fill, counter, button states and video playback never disagree. It never
// scrolls the page.
export function initPhases(): void {
  const items = Array.from(document.querySelectorAll<HTMLElement>('.timeline-item'));
  const panels = Array.from(document.querySelectorAll<HTMLElement>('.phase-content'));
  if (!items.length || !panels.length) return;

  const fill = document.getElementById('timelineTrackFill');
  const prevBtn = document.querySelector<HTMLButtonElement>('[data-phase-prev]');
  const nextBtn = document.querySelector<HTMLButtonElement>('[data-phase-next]');
  const currentOut = document.querySelector<HTMLElement>('[data-phase-current]');
  const track = document.querySelector<HTMLElement>('.timeline-track');
  const MIN = 1;
  const MAX = panels.length;
  let current = 1;

  const fillPercent = (n: number) => `${((n - 0.5) / MAX) * 100}%`;

  function activate(phase: number) {
    const id = String(phase);
    const target = document.getElementById('phase-' + id);
    if (!target) return;
    current = phase;

    items.forEach((item) => {
      const on = item.dataset.phase === id;
      item.classList.toggle('active', on);
      item.setAttribute('aria-selected', String(on));
      item.tabIndex = on ? 0 : -1;
    });
    if (fill) fill.style.width = fillPercent(phase);

    panels.forEach((panel) => {
      const on = panel === target;
      panel.classList.toggle('active', on);
      panel.hidden = !on;
      panel.querySelectorAll('video').forEach((video) => {
        if (on) video.play().catch(() => {});
        else video.pause();
      });
      // Phase media starts inside a hidden (display:none) panel, so a
      // scroll-triggered IntersectionObserver never gets a real chance to
      // see it — observing it at page load reports "not intersecting" once
      // and nothing reliably re-checks it after `hidden` is later cleared.
      // Tab content is shown by a deliberate click, not by scrolling into
      // view, so reveal its wipe-reveal media directly the moment its panel
      // becomes the active one instead of relying on scroll intersection.
      // Deferred one frame so the browser paints the still-clipped state
      // first (display:none -> display:block and the reveal class in the
      // same tick would skip straight to the end state with no transition).
      if (on) {
        const media = panel.querySelectorAll('.wipe-reveal');
        requestAnimationFrame(() => {
          requestAnimationFrame(() => media.forEach((el) => el.classList.add('wipe-revealed')));
        });
      }
    });

    if (currentOut) currentOut.textContent = String(current);
    if (prevBtn) prevBtn.disabled = current <= MIN;
    if (nextBtn) nextBtn.disabled = current >= MAX;
  }

  items.forEach((item) => {
    item.addEventListener('click', () => activate(Number(item.dataset.phase)));
  });
  prevBtn?.addEventListener('click', () => {
    if (current > MIN) activate(current - 1);
  });
  nextBtn?.addEventListener('click', () => {
    if (current < MAX) activate(current + 1);
  });
  track?.addEventListener('keydown', (e) => {
    const rtl = document.documentElement.dir === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === forward && current < MAX) {
      e.preventDefault();
      activate(current + 1);
      items[current - 1]?.focus();
    } else if (e.key === back && current > MIN) {
      e.preventDefault();
      activate(current - 1);
      items[current - 1]?.focus();
    }
  });

  activate(1);
}
