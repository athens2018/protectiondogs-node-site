// Pointer-only flourishes. Every one of these is an enhancement layered on a
// page that is complete without it: hero cursor glow, magnetic primary
// buttons, and the clip-path wipe for phase media. The wipe's hidden state
// is gated in CSS by html.pdg-anim.pdg-io, so a script that never runs
// leaves the media fully visible.
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

  const wipes = document.querySelectorAll<HTMLElement>('.wipe-reveal');
  if (wipes.length && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('wipe-revealed');
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2 },
    );
    wipes.forEach((el) => observer.observe(el));
  } else {
    wipes.forEach((el) => el.classList.add('wipe-revealed'));
  }
}
