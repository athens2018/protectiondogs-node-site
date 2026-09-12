// Access control for the private gallery (src/pages/gallery/**) — a
// deliberately lighter mechanism than the admin panel's password + HMAC
// session (see src/lib/admin-auth.ts): the owner approves a named request
// (src/pages/admin/gallery/**), the visitor gets one emailed link
// containing a random token, and that same token becomes a long-lived
// cookie from then on. No password to set or remember. The token itself
// (32 random bytes, high entropy) is the credential — unlike a
// human-chosen password, it doesn't need a slow salted KDF, so this stores
// a plain SHA-256 hash of it rather than reusing admin-auth's scrypt.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';

export const GALLERY_COOKIE = 'pdg_gallery_access';
const COOKIE_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 days — long-lived, not "session"

/** A new raw access token to email to a just-approved visitor. Store only hashAccessToken(this) — never the raw value. */
export function generateAccessToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Timing-safe comparison against a stored hash — never a plain `===`. */
export function accessTokenMatches(token: string, storedHash: string): boolean {
  const actual = Buffer.from(hashAccessToken(token), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function setGalleryAccessCookie(cookies: AstroCookies, token: string): void {
  cookies.set(GALLERY_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/gallery',
    maxAge: COOKIE_TTL_MS / 1000,
  });
}

/** Reads a raw token from the gallery cookie, or a `?token=` query param (the first visit, straight from the approval email, before the cookie exists). */
export function readAccessToken(cookies: AstroCookies, url: URL): string | null {
  return cookies.get(GALLERY_COOKIE)?.value ?? url.searchParams.get('token') ?? null;
}
