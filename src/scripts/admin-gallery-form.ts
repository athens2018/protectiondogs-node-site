// Gallery upload form behavior (src/pages/admin/gallery/index.astro):
// "AI fix" for the caption, and the upload itself — a direct-to-Blob PUT
// (see admin/api/gallery/upload-url.ts's own comment for why: a Vercel
// Function request body is capped at 4.5MB, which a real training video —
// and plenty of ordinary phone photos — exceeds). This intercepts the
// form's submit, uploads the picked file straight to Blob storage, then
// submits the rest of the fields (metadata only, no bytes) to
// admin/api/gallery/items/ exactly like a plain form post would.
export function initAdminGalleryForm(): void {
  initCaptionFix();
  initUploadForm();
}

function initCaptionFix(): void {
  const button = document.getElementById('gallery-caption-fix') as HTMLButtonElement | null;
  const field = document.getElementById('gallery-caption') as HTMLInputElement | null;
  if (!button || !field) return;

  const label = button.querySelector<HTMLElement>('.btn__label') || button;
  const idleLabel = label.textContent?.trim() || 'AI fix';

  button.addEventListener('click', () => {
    const text = field.value.trim();
    if (!text || button.disabled) return;

    button.disabled = true;
    label.textContent = 'Fixing…';

    fetch('/admin/api/gallery/fix-caption/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
      .then((res) => res.json())
      .then((data: { ok: boolean; text?: string; error?: string }) => {
        if (data.ok && data.text) {
          field.value = data.text;
        } else {
          alert(data.error || 'AI fix failed.');
        }
      })
      .catch(() => alert('AI fix failed — network error.'))
      .finally(() => {
        button.disabled = false;
        label.textContent = idleLabel;
      });
  });
}

function initUploadForm(): void {
  const form = document.getElementById('gallery-upload-form') as HTMLFormElement | null;
  const fileInput = document.getElementById('gallery-file') as HTMLInputElement | null;
  const status = document.getElementById('gallery-upload-status');
  const submitButton = document.getElementById('gallery-upload-submit') as HTMLButtonElement | null;
  if (!form || !fileInput || !submitButton) return;

  const submitLabel = submitButton.querySelector<HTMLElement>('.btn__label') || submitButton;
  const idleLabel = submitLabel.textContent?.trim() || 'Upload';

  function setStatus(text: string) {
    if (status) status.textContent = text;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (submitButton.disabled) return;

    const file = fileInput.files?.[0];
    if (!file) {
      setStatus('Choose a photo or video first.');
      return;
    }

    submitButton.disabled = true;
    submitLabel.textContent = 'Uploading…';
    setStatus('Requesting upload URL…');

    fetch('/admin/api/gallery/upload-url/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: file.type, sizeBytes: file.size }),
    })
      .then((res) => res.json())
      .then((data: { ok: boolean; presignedUrl?: string; url?: string; error?: string }) => {
        if (!data.ok || !data.presignedUrl || !data.url) throw new Error(data.error || 'Could not prepare the upload.');

        setStatus('Uploading…');
        return fetch(data.presignedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file }).then((putRes) => {
          if (!putRes.ok) throw new Error(`Upload failed (${putRes.status}).`);
          return data.url!;
        });
      })
      .then((url) => {
        setStatus('Saving…');
        const formData = new FormData(form);
        formData.delete('file');
        formData.set('url', url);
        formData.set('contentType', file.type);
        return fetch(form.action, { method: 'POST', body: formData });
      })
      .then((res) => {
        // The server answers a redirect for a non-Bearer (web) request —
        // fetch follows it by default, so `res.url` is the final admin
        // page URL, same destination a plain form submission would land on.
        window.location.href = res.url;
      })
      .catch((err: Error) => {
        setStatus(err.message || 'Upload failed.');
        submitButton.disabled = false;
        submitLabel.textContent = idleLabel;
      });
  });
}
