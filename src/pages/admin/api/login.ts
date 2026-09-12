import type { APIRoute } from 'astro';
import { checkPassword, getAdminConfig, isRateLimited, recordLoginAttempt, clearLoginAttempts, setSessionCookie } from '../../../lib/admin-auth';

export const prerender = false;

function redirectWithError(message: string): Response {
  const location = `/admin/login/?error=${encodeURIComponent(message)}`;
  return new Response(null, { status: 303, headers: { Location: location } });
}

export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
  const config = getAdminConfig();
  if (!config) {
    // Fail closed: an unconfigured admin panel must never grant access,
    // and must say exactly why rather than looking like a wrong password.
    return redirectWithError('not-configured');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirectWithError('bad-request');
  }
  const password = String(form.get('password') ?? '');

  // Rate-limit keyed on client IP; falls back to a shared bucket if the
  // adapter can't provide one rather than throwing (never let a rate
  // limiter itself become the outage).
  let ip = 'unknown';
  try {
    ip = clientAddress ?? 'unknown';
  } catch {
    /* not available in this environment; fall back to the shared bucket */
  }

  if (isRateLimited(ip)) {
    return redirectWithError('rate-limited');
  }

  if (!checkPassword(password, config)) {
    recordLoginAttempt(ip);
    return redirectWithError('invalid');
  }

  clearLoginAttempts(ip);
  setSessionCookie(cookies, config.sessionSecret);
  return new Response(null, { status: 303, headers: { Location: '/admin/dogs/' } });
};
