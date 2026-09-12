import type { APIRoute } from 'astro';
import { checkAdminAccess } from '../../../../lib/admin-auth';
import { restoreGalleryHistoryVersion } from '../../../../lib/cms';

export const prerender = false;

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const access = checkAdminAccess(cookies);
  if (!access.ok) return redirect('/admin/login/');

  const form = await request.formData();
  const version = Number(form.get('version'));
  if (!Number.isFinite(version)) {
    return redirect(`/admin/gallery/history/?error=${encodeURIComponent('Invalid version.')}`);
  }

  const result = await restoreGalleryHistoryVersion(version);
  if (!result.ok) {
    return redirect(`/admin/gallery/history/?error=${encodeURIComponent('Restore failed — that version may no longer be available.')}`);
  }

  return redirect('/admin/gallery/?saved=1');
};
