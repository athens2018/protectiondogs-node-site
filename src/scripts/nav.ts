// Mobile menu. Ids/classes (#navbarNav, .navbar-toggler, .nav-link) are kept
// because the frozen PWA layer (app-mode.js) reads them.
export function initNav(): void {
  const toggle = document.querySelector<HTMLButtonElement>('.navbar-toggler');
  const menu = document.getElementById('navbarNav');
  if (!toggle || !menu) return;

  const isOpen = () => menu.classList.contains('show');
  const setOpen = (open: boolean) => {
    menu.classList.toggle('show', open);
    toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('nav-open', open);
  };

  toggle.addEventListener('click', () => setOpen(!isOpen()));

  menu.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', () => {
      if (isOpen()) setOpen(false);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      setOpen(false);
      toggle.focus();
    }
  });

  document.addEventListener('click', (e) => {
    const t = e.target as Node;
    if (isOpen() && !menu.contains(t) && !toggle.contains(t)) setOpen(false);
  });

  const mq = window.matchMedia('(min-width: 992px)');
  mq.addEventListener('change', () => {
    if (mq.matches && isOpen()) setOpen(false);
  });
}
