// "Add to Home Screen" for the private gallery
// (src/pages/gallery/index.astro) — so a visitor can get back in with one
// tap instead of hunting through email for the access link every time.
// Android/Chrome: capture the deferred `beforeinstallprompt` event and show
// a real "Install" button that triggers the native prompt. iOS Safari never
// fires that event — there is no programmatic install API there at all —
// so this shows static "Share -> Add to Home Screen" instructions instead,
// detected by user agent rather than feature-testing (there's nothing to
// feature-test for; the event simply never arrives).
export function initGalleryInstall(): void {
  const banner = document.getElementById('gallery-install-banner');
  const installButton = document.getElementById('gallery-install-button') as HTMLButtonElement | null;
  const iosHint = document.getElementById('gallery-install-ios-hint');
  if (!banner) return;

  // Already running as the installed app (or an iOS home-screen launch) —
  // nothing to offer.
  const nav = navigator as Navigator & { standalone?: boolean };
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
  if (isStandalone) return;

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

  let deferredPrompt: Event & { prompt?: () => void; userChoice?: Promise<unknown> } = null as unknown as Event;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as typeof deferredPrompt;
    banner.hidden = false;
    if (installButton) installButton.hidden = false;
    if (iosHint) iosHint.hidden = true;
  });

  installButton?.addEventListener('click', () => {
    if (!deferredPrompt?.prompt) return;
    deferredPrompt.prompt();
    Promise.resolve(deferredPrompt.userChoice).finally(() => {
      deferredPrompt = null as unknown as Event;
      banner.hidden = true;
    });
  });

  if (isIos) {
    banner.hidden = false;
    if (installButton) installButton.hidden = true;
    if (iosHint) iosHint.hidden = false;
  }
}
