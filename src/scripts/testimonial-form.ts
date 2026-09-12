// Public testimonial submission form: client-side validation, fetch
// submission to /api/testimonials/submit/, and inline success/error text
// (a self-contained variant of src/scripts/form.ts's pattern — kept
// separate since the fields and the API's response shape both differ).
export function initTestimonialForm(): void {
  const form = document.getElementById('testimonial-form') as HTMLFormElement | null;
  if (!form) return;

  const msg = form.dataset;
  const status = document.getElementById('testimonial-form-status');
  const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const idleLabel = submitButton?.textContent?.trim() || '';

  function setStatus(text: string, kind: 'success' | 'error' | '') {
    if (!status) return;
    status.textContent = text;
    status.className = kind ? `testimonial-form__status testimonial-form__status--${kind}` : 'testimonial-form__status';
  }

  // Required fields rely on the browser's own validation (this form has no
  // `novalidate`) rather than reimplementing it — the submit listener only
  // ever runs once name/quote already have content.
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (form.dataset.sending === 'true') return;

    form.dataset.sending = 'true';
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = msg.msgSending || idleLabel;
    }
    setStatus('', '');

    fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } })
      .then((response) =>
        response.json().then((data: { ok: boolean; error?: string }) => {
          if (response.ok && data.ok) {
            setStatus(msg.msgSuccess || '', 'success');
            form.reset();
          } else {
            setStatus(data.error || msg.msgError || '', 'error');
          }
        }),
      )
      .catch(() => setStatus(msg.msgError || '', 'error'))
      .finally(() => {
        form.dataset.sending = 'false';
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = idleLabel;
        }
      });
  });
}
