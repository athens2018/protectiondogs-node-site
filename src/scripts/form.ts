// Enquiry form: client validation, a re-entry guard so nothing is ever sent
// twice, fetch submission, and toast feedback. Every visible string comes
// from data-* attributes rendered from the locale JSON.
export function initForm(): void {
  const form = document.getElementById('contact-form') as HTMLFormElement | null;
  if (!form) return;

  const msg = form.dataset;
  const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const submitLabel = submitButton?.querySelector<HTMLElement>('.btn__label') || submitButton;
  const idleLabel = submitLabel?.textContent?.trim() || '';

  const setError = (field: HTMLElement | null, text: string) => {
    if (!field) return;
    const id = field.getAttribute('aria-describedby');
    const box = id ? document.getElementById(id) : null;
    if (box) box.textContent = text;
    field.setAttribute('aria-invalid', text ? 'true' : 'false');
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (form.dataset.sending === 'true') return;

    const name = form.querySelector<HTMLInputElement>('#name');
    const email = form.querySelector<HTMLInputElement>('#email');
    const message = form.querySelector<HTMLTextAreaElement>('#message');
    const consent = form.querySelector<HTMLInputElement>('#privacy-consent');

    [name, email, message, consent].forEach((f) => setError(f, ''));

    const invalid: HTMLElement[] = [];
    const fail = (field: HTMLElement | null, text: string) => {
      setError(field, text);
      if (field) invalid.push(field);
    };

    if (name && !name.value.trim()) fail(name, msg.msgName || '');
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (email && (!email.value.trim() || !emailRegex.test(email.value))) fail(email, msg.msgEmail || '');
    if (message && !message.value.trim()) fail(message, msg.msgMessage || '');
    if (consent && !consent.checked) fail(consent, msg.msgConsent || '');

    if (invalid.length) {
      invalid[0].focus();
      return;
    }

    if (submitButton) submitButton.disabled = true;
    form.dataset.sending = 'true';
    if (submitLabel) submitLabel.textContent = msg.msgSending || idleLabel;
    submitButton?.classList.add('is-busy');

    fetch(form.action, {
      method: 'POST',
      body: new FormData(form),
      headers: { Accept: 'application/json' },
    })
      .then((response) => {
        if (response.ok) {
          notify(msg.msgSuccess || '', 'success');
          form.dispatchEvent(new CustomEvent('pdg-enquiry-success'));
          form.reset();
          return;
        }
        form.dispatchEvent(new CustomEvent('pdg-enquiry-failed', { detail: { reason: 'server_' + response.status } }));
        return response
          .json()
          .then((data: { errors?: { message: string }[] }) => {
            if (data && Array.isArray(data.errors) && data.errors.length) {
              notify(data.errors.map((e) => e.message).join(', '), 'error');
            } else {
              notify(msg.msgFailure || '', 'error');
            }
          })
          .catch(() => notify(msg.msgFailure || '', 'error'));
      })
      .catch(() => {
        form.dispatchEvent(new CustomEvent('pdg-enquiry-failed', { detail: { reason: 'network' } }));
        notify(msg.msgNetwork || '', 'error');
      })
      .finally(() => {
        if (submitButton) submitButton.disabled = false;
        form.dataset.sending = 'false';
        if (submitLabel) submitLabel.textContent = idleLabel;
        submitButton?.classList.remove('is-busy');
      });
  });

  function notify(text: string, type: 'success' | 'error') {
    const container = document.querySelector<HTMLElement>('.notification-container');
    if (!container || !text) return;
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', 'alert');
    // May echo what the visitor typed (server validation errors do): text, never HTML.
    const body = document.createElement('p');
    body.className = 'toast__text';
    body.textContent = text;
    toast.appendChild(body);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'toast__close';
    closeBtn.setAttribute('aria-label', container.dataset.labelClose || 'Close');
    closeBtn.textContent = '×';
    const remove = () => {
      toast.classList.remove('is-shown');
      window.setTimeout(() => toast.remove(), 220);
    };
    closeBtn.addEventListener('click', remove);
    toast.appendChild(closeBtn);
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-shown'));
    window.setTimeout(remove, 6000);
  }
}
