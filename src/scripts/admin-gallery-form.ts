// "AI fix" button for the gallery upload form's caption field
// (src/pages/admin/gallery/index.astro) — sends the owner's rough text to
// /admin/api/gallery/fix-caption/ and replaces the field with the cleaned
// result.
export function initAdminGalleryForm(): void {
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
