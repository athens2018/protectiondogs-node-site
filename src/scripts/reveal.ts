// Scroll-linked reveals. Elements only start hidden once BOTH html.pdg-anim
// (head script, reduced-motion opt-in) and html.pdg-io (added here, only
// after the observer exists) are present — see global.css. The hero never
// uses .reveal; its entrance is pure CSS keyframes with no module dependency.
export function initReveal(): void {
  const html = document.documentElement;
  if (!html.classList.contains('pdg-anim')) return;
  if (!('IntersectionObserver' in window)) return;

  const targets = Array.from(document.querySelectorAll<HTMLElement>('.reveal'));
  if (targets.length === 0) return;

  const show = (el: Element) => el.classList.add('is-visible');

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          show(entry.target);
          io.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.06 },
  );

  html.classList.add('pdg-io');
  requestAnimationFrame(() => targets.forEach((el) => io.observe(el)));

  // Belt and braces: whatever the observer never reported, show anyway.
  window.setTimeout(() => targets.forEach(show), 4000);
}
