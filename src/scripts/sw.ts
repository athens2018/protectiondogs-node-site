import { hasConsent } from './consent';

// Installable web app: registers the service worker (network-first for
// pages, so the installed app always shows the live site). The last outcome
// is kept on the device (localStorage pdg-sw) so a stale or failed worker can
// be diagnosed on a customer's phone.
export function initServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        try {
          localStorage.setItem('pdg-sw', 'ok ' + new Date().toISOString().slice(0, 10));
        } catch {
          /* ignore */
        }
        reg.addEventListener('updatefound', () => {
          try {
            localStorage.setItem('pdg-sw', 'update ' + new Date().toISOString().slice(0, 10));
          } catch {
            /* ignore */
          }
        });
      })
      .catch((err: unknown) => {
        const msg = String((err && (err as Error).message) || err).slice(0, 120);
        try {
          localStorage.setItem('pdg-sw', 'error ' + msg);
        } catch {
          /* ignore */
        }
        console.warn('Service worker registration failed:', msg);
        if (hasConsent() && typeof window.gtag === 'function') {
          window.gtag('event', 'sw_registration_failed', {
            event_category: 'pwa',
            event_label: msg,
            non_interaction: true,
          });
        }
      });
  });
}
