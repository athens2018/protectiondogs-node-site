import type { APIRoute } from 'astro';
import { checkAdminAccess } from '../../../../lib/admin-auth';
import { restoreDogsHistoryVersion } from '../../../../lib/cms';
import { triggerDeploy } from '../../../../lib/deploy-hook';

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
    return redirect(`/admin/dogs/history/?error=${encodeURIComponent('Invalid version.')}`);
  }

  const result = await restoreDogsHistoryVersion(version);
  if (!result.ok) {
    return redirect(`/admin/dogs/history/?error=${encodeURIComponent('Restore failed — that version may no longer be available.')}`);
  }

  await triggerDeploy();
  return redirect('/admin/dogs/?saved=1');
};
