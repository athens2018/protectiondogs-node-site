import type { APIRoute } from 'astro';
import { checkPassword, getAdminConfig, isRateLimited, recordLoginAttempt, clearLoginAttempts, mintMobileToken } from '../../../lib/admin-auth';

export const prerender = false;

/**
 * The mobile counterpart to admin/api/login.ts — the private portal's
 * native app (private-portal/native-app) has its own session cookie jar
 * for its own backend, not this one, so it authenticates here once with
 * the same admin password and stores the returned bearer token instead of
 * a cookie. Shares the exact same password check and IP rate limiter as
 * the web login route; only the response shape (JSON + token, not a
 * redirect + Set-Cookie) differs.
 */
function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), { status, headers: { 'Content-Type': 'application/json' } });
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const config = getAdminConfig();
  if (!config) return jsonError(503, 'not-configured');

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'bad-request');
  }
  const password = typeof body.password === 'string' ? body.password : '';

  let ip = 'unknown';
  try {
    ip = clientAddress ?? 'unknown';
  } catch {
    /* not available in this environment; fall back to the shared bucket */
  }

  if (isRateLimited(ip)) return jsonError(429, 'rate-limited');

  if (!checkPassword(password, config)) {
    recordLoginAttempt(ip);
    return jsonError(401, 'invalid');
  }

  clearLoginAttempts(ip);
  const token = mintMobileToken(config.sessionSecret);
  return new Response(JSON.stringify({ ok: true, token }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
