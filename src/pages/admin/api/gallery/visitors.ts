import type { APIRoute } from 'astro';
import { checkAdminAccess } from '../../../../lib/admin-auth';
import { getGallerySection, saveGallerySection } from '../../../../lib/cms';
import { generateAccessToken, hashAccessToken } from '../../../../lib/gallery-auth';
import { sendEmail } from '../../../../lib/notify';

export const prerender = false;

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

function withError(message: string): Response {
  return redirect(`/admin/gallery/?error=${encodeURIComponent(message)}`);
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const access = checkAdminAccess(cookies);
  if (!access.ok) return redirect('/admin/login/');

  const form = await request.formData();
  const action = String(form.get('action') ?? '');
  const visitorId = String(form.get('id') ?? '');
  const versionRaw = form.get('version');
  const expectedVersion = Number(versionRaw);
  if (!Number.isFinite(expectedVersion)) return withError('Missing or invalid version.');

  const current = await getGallerySection();
  if (current.version !== expectedVersion) {
    return withError('Someone else changed this since you loaded the page. Reload and try again.');
  }

  const index = current.visitors.findIndex((v) => v.id === visitorId);
  if (index === -1) return withError(`No visitor with id "${visitorId}".`);
  const visitor = current.visitors[index];

  let nextVisitors = current.visitors;
  let approvalEmail: { to: string; token: string } | null = null;

  if (action === 'approve') {
    const token = generateAccessToken();
    approvalEmail = { to: visitor.email, token };
    nextVisitors = current.visitors.map((v, i) =>
      i === index ? { ...v, status: 'approved' as const, accessTokenHash: hashAccessToken(token), approvedAt: new Date().toISOString() } : v,
    );
  } else if (action === 'revoke') {
    nextVisitors = current.visitors.map((v, i) => (i === index ? { ...v, status: 'revoked' as const, accessTokenHash: null } : v));
  } else if (action === 'delete') {
    nextVisitors = current.visitors.filter((_, i) => i !== index);
  } else {
    return withError(`Unknown action "${action}".`);
  }

  const saveResult = await saveGallerySection({ ...current, visitors: nextVisitors }, expectedVersion);
  if (!saveResult.ok) {
    if (saveResult.error === 'stale') return withError('Someone else changed this since you loaded the page. Reload and try again.');
    if (saveResult.error === 'no-store') {
      return withError('The CMS storage isn\'t connected yet (CMS_BLOB_READ_WRITE_TOKEN_STORE_ID is not set) — nothing was saved.');
    }
    return withError('Save failed. Please try again.');
  }

  if (approvalEmail) {
    await sendEmail(
      approvalEmail.to,
      "You're approved — Protection Dogs GR private gallery",
      [
        `Hi ${visitor.name},`,
        '',
        "You've been approved to view our private gallery of real training footage — the day-to-day, not the highlight reel.",
        '',
        `Here's your link: https://www.protectiondogs.gr/gallery/?token=${approvalEmail.token}`,
        '',
        "It's just for you — no account or password needed, and it'll keep working from this link (or once you visit, from the same browser) whenever you want to check back in.",
      ].join('\n'),
    );
  }

  return redirect('/admin/gallery/?saved=1');
};
