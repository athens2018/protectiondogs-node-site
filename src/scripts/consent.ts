// Cookie consent gates Analytics entirely: nothing is sent to Google and no
// event fires until the visitor explicitly accepts. Keys and the GA id are
// carried over from the live site so existing visitors' choices still hold.
const CONSENT_KEY = 'pdg-analytics-consent';
const GA_ID = 'G-JPYMVN5GS5';

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
    hasAnalyticsConsent: () => boolean;
    pdgTrack: (name: string, params?: Record<string, unknown>) => void;
  }
}

export function hasConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'granted';
  } catch {
    return false;
  }
}

function ensureGtagStub(): void {
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function () {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer.push(arguments);
    };
  }
}

function loadAnalytics(): void {
  ensureGtagStub();
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
  window.gtag('js', new Date());
  window.gtag('config', GA_ID);
}

export function track(name: string, params?: Record<string, unknown>): void {
  try {
    if (hasConsent() && typeof window.gtag === 'function') {
      window.gtag('event', name, params || {});
    }
  } catch {
    /* analytics must never break the page */
  }
}

export function initConsent(): void {
  window.hasAnalyticsConsent = hasConsent;
  window.pdgTrack = track;

  const banner = document.getElementById('cookieConsent');
  const acceptBtn = document.getElementById('cookieAccept');
  const rejectBtn = document.getElementById('cookieReject');
  if (!banner || !acceptBtn || !rejectBtn) return;

  let existing: string | null = null;
  try {
    existing = localStorage.getItem(CONSENT_KEY);
  } catch {
    /* storage unavailable: treat as undecided but do not persist */
  }

  const hide = () => {
    banner.classList.remove('visible');
    banner.setAttribute('aria-hidden', 'true');
  };

  if (existing === 'granted') {
    loadAnalytics();
  } else if (!existing) {
    banner.classList.add('visible');
    banner.setAttribute('aria-hidden', 'false');
  }

  acceptBtn.addEventListener('click', () => {
    try {
      localStorage.setItem(CONSENT_KEY, 'granted');
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event('pdg-consent-granted'));
    hide();
    loadAnalytics();
  });

  rejectBtn.addEventListener('click', () => {
    try {
      localStorage.setItem(CONSENT_KEY, 'denied');
    } catch {
      /* ignore */
    }
    hide();
  });
}
