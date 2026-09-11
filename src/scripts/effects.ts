// Pointer-only flourishes: hero cursor glow and magnetic primary buttons.
// Every one of these is an enhancement layered on a page that is complete
// without it. (The clip-path wipe for phase media used to be handled here
// via a scroll IntersectionObserver, but that media starts inside a hidden
// tab panel and a click — not a scroll — is what reveals it, so that reveal
// now lives in phases.ts's activate(), right where the panel is shown.)
export function initEffects(): void {
  const hoverCapable = window.matchMedia('(hover: hover)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const wantsMotion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const hero = document.querySelector<HTMLElement>('.hero');
  if (hero && hoverCapable) {
    hero.addEventListener('mousemove', (e) => {
      const rect = hero.getBoundingClientRect();
      hero.style.setProperty('--glow-x', ((e.clientX - rect.left) / rect.width) * 100 + '%');
      hero.style.setProperty('--glow-y', ((e.clientY - rect.top) / rect.height) * 100 + '%');
    });
  }

  if (finePointer && wantsMotion) {
    document.querySelectorAll<HTMLElement>('.btn--primary').forEach((btn) => {
      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        btn.style.transform = `translate(${x * 0.12}px, ${y * 0.12}px)`;
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = '';
      });
    });
  }
}
