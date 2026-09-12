// Auth for the admin/CMS panel (src/pages/admin/**). Single owner, no
// client base — deliberately dependency-free (Node's built-in `crypto`
// only) rather than pulling in better-auth or any session library, per
// the brief. Mirrors the *pattern* private-portal/app/src/lib/owner-guard.ts
// uses (one shared guard called at the top of every protected route) for
// consistency across this owner's two projects, without sharing any code
// or auth mechanism — private-portal is a completely separate app.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';

const SESSION_COOKIE = 'pdg_admin_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, no "remember me" complexity

// ---------- Password hashing ----------
// ADMIN_PASSWORD_HASH is a "<saltHex>:<keyHex>" string produced by
// scrypt (Node's built-in, no new dependency). See the repo README section
// added below / the deployment report for the exact one-liner the owner
// runs to generate this value.

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const key = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${key}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, keyHex] = stored.split(':');
  if (!salt || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  // Fixed-length buffers of the same size required by timingSafeEqual;
  // scryptSync above is called with expected.length so this always holds.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------- Session cookie: HMAC-signed, home-rolled (no JWT dependency) ----------

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

interface SessionPayload {
  iat: number;
  exp: number;
}

function mintSessionToken(secret: string): string {
  const now = Date.now();
  const payload: SessionPayload = { iat: now, exp: now + SESSION_TTL_MS };
  const encoded = b64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, secret)}`;
}

function verifySessionToken(token: string, secret: string): boolean {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return false;
  const expected = sign(encoded, secret);
  // Different-length base64url signatures would throw in timingSafeEqual;
  // both sides are always a base64url sha256 digest of equal length, but
  // guard defensively against a corrupted/foreign cookie value anyway.
  if (expected.length !== signature.length) return false;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    return typeof payload.exp === 'number' && Date.now() < payload.exp;
  } catch {
    return false;
  }
}

export function setSessionCookie(cookies: AstroCookies, secret: string): void {
  cookies.set(SESSION_COOKIE, mintSessionToken(secret), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/admin',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/admin' });
}

function hasValidSession(cookies: AstroCookies, secret: string): boolean {
  const token = cookies.get(SESSION_COOKIE)?.value;
  return !!token && verifySessionToken(token, secret);
}

// ---------- Login rate limiting ----------
// Simple in-memory counter, module-scoped. Given single-tenant scale this
// is intentionally not distributed/persistent (a cold serverless instance
// resets it) — it slows down casual brute-forcing without pretending to be
// a real WAF. See the brief: "don't overengineer, but don't leave it fully
// unprotected either."
const LOGIN_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 8;
const loginAttempts = new Map<string, { count: number; windowStart: number }>();

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.windowStart > LOGIN_ATTEMPT_WINDOW_MS) return false;
  return entry.count >= LOGIN_ATTEMPT_LIMIT;
}

export function recordLoginAttempt(key: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.windowStart > LOGIN_ATTEMPT_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}

export function clearLoginAttempts(key: string): void {
  loginAttempts.delete(key);
}

// ---------- Config + the shared guard ----------

export interface AdminConfig {
  passwordHash: string;
  sessionSecret: string;
}

/** Reads the two required env vars. Returns null if either is missing — callers must fail closed, never fail open, when this happens. */
export function getAdminConfig(): AdminConfig | null {
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  const sessionSecret = process.env.ADMIN_SESSION_SECRET;
  if (!passwordHash || !sessionSecret) return null;
  return { passwordHash, sessionSecret };
}

export function checkPassword(password: string, config: AdminConfig): boolean {
  return verifyPassword(password, config.passwordHash);
}

export type AdminGuardResult = { ok: true } | { ok: false; reason: 'not-configured' | 'unauthenticated' };

/**
 * The shared check every admin/** page and API route must call first —
 * never rely on client-side JS alone to gate access. Distinguishes "the
 * owner hasn't set the env vars yet" (fail closed with a clear message,
 * never fail open) from "no valid session" (send to /admin/login) so
 * both pages and API routes can react appropriately.
 */
export function checkAdminAccess(cookies: AstroCookies): AdminGuardResult {
  const config = getAdminConfig();
  if (!config) return { ok: false, reason: 'not-configured' };
  if (!hasValidSession(cookies, config.sessionSecret)) return { ok: false, reason: 'unauthenticated' };
  return { ok: true };
}
