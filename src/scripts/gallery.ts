// Client-side behavior for the private gallery page
// (src/pages/gallery/index.astro): the request-access form, "interested"
// taps, and a tracking beacon on the "Contact now" WhatsApp link.
export function initGalleryPage(): void {
  initRequestForm();
  initInterestButtons();
  initContactLink();
}

function initRequestForm(): void {
  const form = document.getElementById('gallery-request-form') as HTMLFormElement | null;
  if (!form) return;
  const status = document.getElementById('gallery-request-status');
  const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const idleLabel = submitButton?.textContent?.trim() || 'Request access';

  function setStatus(text: string, kind: 'success' | 'error' | '') {
    if (!status) return;
    status.textContent = text;
    status.className = kind ? `gallery-request-status gallery-request-status--${kind}` : 'gallery-request-status';
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (form.dataset.sending === 'true') return;
    form.dataset.sending = 'true';
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Sending…';
    }
    setStatus('', '');

    fetch('/api/gallery/request/', { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } })
      .then((response) =>
        response.json().then((data: { ok: boolean; error?: string; alreadyRequested?: boolean; message?: string }) => {
          if (response.ok && data.ok) {
            if (data.alreadyRequested) {
              setStatus(data.message || 'Request already on file.', 'success');
            } else {
              setStatus("Thank you — we'll be in touch by email once your request is reviewed.", 'success');
              form.reset();
            }
          } else {
            setStatus(data.error || 'Something went wrong. Please try again.', 'error');
          }
        }),
      )
      .catch(() => setStatus('Something went wrong. Please try again.', 'error'))
      .finally(() => {
        form.dataset.sending = 'false';
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = idleLabel;
        }
      });
  });
}

function initInterestButtons(): void {
  const grid = document.querySelector<HTMLElement>('[data-gallery-grid]');
  if (!grid) return;
  const token = grid.dataset.token;
  if (!token) return;

  grid.querySelectorAll<HTMLButtonElement>('.gallery-interest').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      const itemId = button.dataset.itemId;
      if (!itemId) return;
      button.disabled = true;
      const countEl = button.querySelector('.gallery-interest__count');
      if (countEl) {
        const current = Number(countEl.textContent?.replace(/[()]/g, '')) || 0;
        countEl.textContent = `(${current + 1})`;
      }
      fetch('/api/gallery/track/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action: 'interest', itemId }),
      }).catch(() => {});
    });
  });
}

function initContactLink(): void {
  const link = document.getElementById('gallery-contact-link') as HTMLAnchorElement | null;
  if (!link) return;
  const token = link.dataset.token;
  if (!token) return;

  link.addEventListener('click', () => {
    // Fire-and-forget alongside the normal navigation (target="_blank") —
    // never delay or block opening WhatsApp for this.
    try {
      const body = JSON.stringify({ token, action: 'contact' });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/gallery/track/', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/gallery/track/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
      }
    } catch {
      /* tracking is best-effort; never let it interfere with the actual contact action */
    }
  });
}
