import type { APIRoute } from 'astro';
import { checkAdminAccess } from '../../../../lib/admin-auth';
import { getGallerySection, saveGallerySection, type GalleryItem } from '../../../../lib/cms';
import { storeUploadedMedia, IMAGE_TYPES } from '../../../../lib/media-upload';
import { validateGalleryItemMeta } from '../../../../lib/gallery-validate';

export const prerender = false;

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

function withError(message: string): Response {
  return redirect(`/admin/gallery/?error=${encodeURIComponent(message)}#items`);
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const access = checkAdminAccess(cookies);
  if (!access.ok) return redirect('/admin/login/');

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return withError('Malformed submission.');
  }

  const action = String(form.get('action') ?? '');
  const versionRaw = form.get('version');
  const expectedVersion = Number(versionRaw);
  if (!Number.isFinite(expectedVersion)) return withError('Missing or invalid version.');

  const current = await getGallerySection();
  if (current.version !== expectedVersion) {
    return withError('Someone else changed this since you loaded the page. Reload and try again.');
  }

  let nextItems: GalleryItem[];

  if (action === 'upload') {
    const storeId = process.env.CMS_BLOB_READ_WRITE_TOKEN_STORE_ID;
    if (!storeId) return withError('The CMS storage isn\'t connected yet (CMS_BLOB_READ_WRITE_TOKEN_STORE_ID is not set).');

    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) return withError('No file provided.');

    const metaResult = validateGalleryItemMeta({ caption: form.get('caption'), dogId: form.get('dogId'), stage: form.get('stage') });
    if (!metaResult.ok) return withError(`Could not save: ${metaResult.errors.join('; ')}`);

    const uploadResult = await storeUploadedMedia(file, storeId);
    if (!uploadResult.ok) return withError(uploadResult.error);

    const item: GalleryItem = {
      id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: IMAGE_TYPES.has(uploadResult.contentType) ? 'photo' : 'video',
      url: uploadResult.url,
      caption: metaResult.item!.caption,
      dogId: metaResult.item!.dogId,
      stage: metaResult.item!.stage,
      uploadedAt: new Date().toISOString(),
      interestCount: 0,
    };
    nextItems = [item, ...current.items];
  } else if (action === 'delete') {
    const id = String(form.get('id') ?? '');
    nextItems = current.items.filter((i) => i.id !== id);
  } else {
    return withError(`Unknown action "${action}".`);
  }

  const saveResult = await saveGallerySection({ ...current, items: nextItems }, expectedVersion);
  if (!saveResult.ok) {
    if (saveResult.error === 'stale') return withError('Someone else changed this since you loaded the page. Reload and try again.');
    if (saveResult.error === 'no-store') {
      return withError('The CMS storage isn\'t connected yet (CMS_BLOB_READ_WRITE_TOKEN_STORE_ID is not set) — nothing was saved.');
    }
    return withError('Save failed. Please try again.');
  }

  return redirect('/admin/gallery/?saved=1#items');
};
