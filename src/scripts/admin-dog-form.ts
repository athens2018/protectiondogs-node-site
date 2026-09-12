// Progressive-enhancement sugar for the admin Dog edit form
// (src/components/admin/DogForm.astro). None of this is required for the
// form to work correctly — every field it touches is a plain, always-
// submitted input; this only makes irrelevant sections collapse and adds
// a same-origin upload shortcut so the owner doesn't need to know a Blob
// URL by hand. See /admin/api/upload.ts for the endpoint this calls.

function toggleSection(selector: string, show: boolean) {
  document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    el.hidden = !show;
  });
}

function applyStatusVisibility() {
  const statusEl = document.querySelector<HTMLSelectElement>('select[name="status"]');
  const status = statusEl?.value ?? 'available';
  toggleSection('[data-section="reservation"]', status === 'available');
  toggleSection('[data-section="future"]', status === 'future');
  toggleSection('[data-section="available-only"]', status === 'available');
}

function applyStoryVisibility() {
  const enabled = document.querySelector<HTMLInputElement>('#story-enabled')?.checked ?? false;
  toggleSection('[data-section="story"]', enabled);
}

async function handleUpload(input: HTMLInputElement) {
  const targetName = input.dataset.uploadFor;
  if (!targetName || !input.files?.length) return;
  const target = document.querySelector<HTMLInputElement>(`[name="${CSS.escape(targetName)}"]`);
  if (!target) return;

  const original = target.value;
  target.value = 'Uploading…';
  target.disabled = true;

  const body = new FormData();
  body.set('file', input.files[0]);
  body.set('target', targetName);

  try {
    const res = await fetch('/admin/api/upload/', { method: 'POST', body });
    const data = (await res.json()) as { ok: boolean; url?: string; altText?: string | null; error?: string };
    if (data.ok && data.url) {
      target.value = data.url;
      // Only for the main photo, and only if the owner hasn't already
      // written their own alt text — this never overwrites a manual entry.
      if (targetName === 'photo.src' && data.altText) {
        const altField = document.querySelector<HTMLInputElement>('[name="photo.alt.en"]');
        if (altField && !altField.value.trim()) altField.value = data.altText;
      }
    } else {
      target.value = original;
      alert(data.error || 'Upload failed.');
    }
  } catch {
    target.value = original;
    alert('Upload failed — network error.');
  } finally {
    target.disabled = false;
  }
}

function init() {
  const statusEl = document.querySelector<HTMLSelectElement>('select[name="status"]');
  statusEl?.addEventListener('change', applyStatusVisibility);
  applyStatusVisibility();

  const storyEnabled = document.querySelector<HTMLInputElement>('#story-enabled');
  storyEnabled?.addEventListener('change', applyStoryVisibility);
  applyStoryVisibility();

  document.querySelectorAll<HTMLInputElement>('input[type="file"][data-upload-for]').forEach((input) => {
    input.addEventListener('change', () => handleUpload(input));
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
