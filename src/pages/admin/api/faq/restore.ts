import type { APIRoute } from 'astro';
import { waitUntil } from '@vercel/functions';
import { checkAdminAccess } from '../../../../lib/admin-auth';
import { restoreFaqHistoryVersion } from '../../../../lib/cms';
import { triggerDeploy } from '../../../../lib/deploy-hook';
import { notifyOwner, sleep } from '../../../../lib/notify';

export const prerender = false;

const REBUILD_SETTLE_MS = 45_000;

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const access = checkAdminAccess(cookies);
  if (!access.ok) return redirect('/admin/login/');

  const form = await request.formData();
  const version = Number(form.get('version'));
  if (!Number.isFinite(version)) {
    return redirect(`/admin/faq/history/?error=${encodeURIComponent('Invalid version.')}`);
  }

  const result = await restoreFaqHistoryVersion(version);
  if (!result.ok) {
    return redirect(`/admin/faq/history/?error=${encodeURIComponent('Restore failed — that version may no longer be available.')}`);
  }

  await triggerDeploy();
  waitUntil(
    (async () => {
      await sleep(REBUILD_SETTLE_MS);
      await notifyOwner(
        'protectiondogs.gr was just updated',
        `Version ${version} of the FAQ was just restored and should be live now.\n\nhttps://www.protectiondogs.gr/`,
      );
    })(),
  );
  return redirect('/admin/faq/?saved=1');
};
