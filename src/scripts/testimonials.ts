declare global {
  interface Window {
    iFrameResize?: (options: Record<string, unknown>, selector: string) => void;
  }
}

// Testimonial.to is a third party that can set its own cookies, so nothing
// from it (scripts, iframes, preconnects) is fetched until the visitor
// accepts cookies or presses the button. Accepting on the banner while on
// the page loads it immediately.
export function initTestimonials(): void {
  const gate = document.getElementById('testimonial-consent');
  const wrap = document.getElementById('testimonial-embeds');
  const btn = document.getElementById('testimonial-load');
  if (!wrap) return;

  let loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    if (gate) gate.hidden = true;
    if (!wrap) return;

    const frame = wrap.querySelector<HTMLIFrameElement>('iframe[data-src]');
    if (frame) {
      frame.src = frame.getAttribute('data-src') || '';
      frame.removeAttribute('data-src');
    }
    wrap.hidden = false;

    const resizer = document.createElement('script');
    resizer.src = 'https://testimonial.to/js/iframeResizer.min.js';
    resizer.onload = () => {
      if (typeof window.iFrameResize === 'function' && frame) {
        window.iFrameResize({ log: false, checkOrigin: false }, '#' + frame.id);
      }
    };
    document.head.appendChild(resizer);

    const widget = document.createElement('script');
    widget.async = true;
    widget.src = 'https://testimonial.to/js/widget-embed.js';
    document.head.appendChild(widget);

    // The widget injects its own <iframe> with no accessible name: add one.
    const container = wrap.querySelector<HTMLElement>('.testimonial-to-embed');
    if (container) {
      const title = container.dataset.frameTitle || 'Client testimonials';
      const observer = new MutationObserver(() => {
        const f = container.querySelector('iframe');
        if (f && !f.title) {
          f.title = title;
          observer.disconnect();
        }
      });
      observer.observe(container, { childList: true });
    }

    // If the provider never answers (blocked, offline, ad-blocker) hide the
    // section rather than leaving the heading stranded above empty space.
    window.setTimeout(() => {
      const section = document.getElementById('testimonial-widgets');
      if (!section) return;
      const providerLoaded = typeof window.iFrameResize === 'function';
      const embedOk = container && container.querySelector('iframe, img');
      if (!providerLoaded && !embedOk) section.hidden = true;
    }, 6000);
  }

  btn?.addEventListener('click', load);
  window.addEventListener('pdg-consent-granted', load);
  try {
    if (localStorage.getItem('pdg-analytics-consent') === 'granted') load();
  } catch {
    /* ignore */
  }
}
