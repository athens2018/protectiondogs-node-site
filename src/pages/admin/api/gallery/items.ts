import type { APIRoute } from 'astro';
import { checkAdminAccess } from '../../../../lib/admin-auth';
import { getGallerySection, saveGallerySection, type GalleryItem } from '../../../../lib/cms';
import { IMAGE_TYPES, VIDEO_TYPES } from '../../../../lib/media-upload';
import { validateGalleryItemMeta } from '../../../../lib/gallery-validate';

export const prerender = false;

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const POST: APIRoute = async ({ request, cookies }) => {
  // A Bearer request is the portal native app (private-portal/native-app,
  // src/pages/admin/api/mobile-login.ts) uploading directly — it wants a
  // JSON response, not a redirect to a web page it can't render. The web
  // admin form never sends this header, so this check is unambiguous.
  const authHeader = request.headers.get('authorization');
  const isMobile = !!authHeader;

  function fail(status: number, message: string): Response {
    return isMobile ? json(status, { ok: false, error: message }) : redirect(`/admin/gallery/?error=${encodeURIComponent(message)}#items`);
  }

  const access = checkAdminAccess(cookies, authHeader);
  if (!access.ok) return isMobile ? json(401, { ok: false, error: 'unauthorized' }) : redirect('/admin/login/');

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, 'Malformed submission.');
  }

  const action = String(form.get('action') ?? '');
  const versionRaw = form.get('version');
  const expectedVersion = Number(versionRaw);
  if (!Number.isFinite(expectedVersion)) return fail(400, 'Missing or invalid version.');

  const current = await getGallerySection();
  if (current.version !== expectedVersion) {
    return fail(409, 'Someone else changed this since you loaded the page. Reload and try again.');
  }

  let nextItems: GalleryItem[];
  let uploadedItem: GalleryItem | null = null;

  if (action === 'upload') {
    // The file itself is already in Blob storage by the time this runs —
    // see admin/api/gallery/upload-url.ts's own comment for why this route
    // no longer accepts the bytes directly (a Vercel Function's request
    // body is hard-capped at 4.5MB; every gallery photo/video now goes
    // client -> Blob directly via a presigned URL). This call just attaches
    // the metadata to that already-uploaded object.
    const url = String(form.get('url') ?? '');
    const contentType = String(form.get('contentType') ?? '');
    if (!url || (!IMAGE_TYPES.has(contentType) && !VIDEO_TYPES.has(contentType))) {
      return fail(400, 'No uploaded file to attach.');
    }

    const metaResult = validateGalleryItemMeta({ caption: form.get('caption'), dogId: form.get('dogId'), stage: form.get('stage') });
    if (!metaResult.ok) return fail(400, `Could not save: ${metaResult.errors.join('; ')}`);

    uploadedItem = {
      id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: IMAGE_TYPES.has(contentType) ? 'photo' : 'video',
      url,
      caption: metaResult.item!.caption,
      dogId: metaResult.item!.dogId,
      stage: metaResult.item!.stage,
      uploadedAt: new Date().toISOString(),
      interestCount: 0,
    };
    nextItems = [uploadedItem, ...current.items];
  } else if (action === 'delete') {
    const id = String(form.get('id') ?? '');
    nextItems = current.items.filter((i) => i.id !== id);
  } else {
    return fail(400, `Unknown action "${action}".`);
  }

  const saveResult = await saveGallerySection({ ...current, items: nextItems }, expectedVersion);
  if (!saveResult.ok) {
    if (saveResult.error === 'stale') return fail(409, 'Someone else changed this since you loaded the page. Reload and try again.');
    if (saveResult.error === 'no-store') {
      return fail(503, 'The CMS storage isn\'t connected yet (CMS_BLOB_READ_WRITE_TOKEN_STORE_ID is not set) — nothing was saved.');
    }
    return fail(500, 'Save failed. Please try again.');
  }

  if (isMobile) return json(200, { ok: true, item: uploadedItem });
  return redirect('/admin/gallery/?saved=1#items');
};
