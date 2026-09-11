import type { APIRoute } from 'astro';
import { readFeed, readToken, writeFeed, writeToken, type FeedItem, type StoredToken } from '../../../lib/instagram-store';

export const prerender = false;

// Instagram API with Instagram Login (Professional account, no Facebook Page
// needed). Endpoints per Meta's current reference:
//   GET https://graph.instagram.com/me/media
//   GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token
// Long-lived tokens last 60 days and may be refreshed any time after 24h;
// refreshing well before expiry is what keeps the feed from silently dying.
const GRAPH = 'https://graph.instagram.com';
const MEDIA_FIELDS = 'id,media_type,media_url,thumbnail_url,permalink,timestamp';
const MAX_ITEMS = 12;
const REFRESH_AFTER_DAYS = 30;
const DAY_MS = 86_400_000;

function unauthorized(): Response {
  return new Response('Unauthorized', { status: 401 });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function resolveToken(): Promise<StoredToken | null> {
  const stored = await readToken();
  if (stored?.accessToken) return stored;
  const seed = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!seed) return null;
  // First run: adopt the seed token and record it so the rotation can start.
  const token: StoredToken = { accessToken: seed, issuedAt: new Date().toISOString() };
  await writeToken(token);
  return token;
}

async function refreshIfDue(token: StoredToken): Promise<StoredToken> {
  const ageDays = (Date.now() - new Date(token.issuedAt).getTime()) / DAY_MS;
  if (ageDays < REFRESH_AFTER_DAYS) return token;

  const url = `${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token.accessToken)}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error('[cron/instagram] token refresh failed', res.status, await res.text().catch(() => ''));
    return token; // keep using the current token until it actually expires
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) return token;
  const refreshed: StoredToken = { accessToken: data.access_token, issuedAt: new Date().toISOString() };
  await writeToken(refreshed);
  return refreshed;
}

interface MediaNode {
  id: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
}

async function fetchMedia(accessToken: string): Promise<FeedItem[]> {
  const url = `${GRAPH}/me/media?fields=${MEDIA_FIELDS}&limit=${MAX_ITEMS}&access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`me/media ${res.status}: ${await res.text().catch(() => '')}`);
  const data = (await res.json()) as { data?: MediaNode[] };
  return (data.data ?? [])
    .map((m) => ({
      id: m.id,
      permalink: m.permalink,
      // Videos expose a poster frame as thumbnail_url; images/albums use media_url.
      image: (m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url) ?? '',
      timestamp: m.timestamp,
    }))
    .filter((i) => i.image && i.permalink);
}

export const GET: APIRoute = async ({ request }) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return unauthorized();

  const token = await resolveToken();
  if (!token) return json(503, { ok: false, reason: 'no_token', hint: 'Set INSTAGRAM_ACCESS_TOKEN to seed the rotation.' });

  try {
    const current = await refreshIfDue(token);
    const items = await fetchMedia(current.accessToken);
    if (items.length) {
      await writeFeed({ items, fetchedAt: new Date().toISOString() });
    }
    const previous = items.length ? null : await readFeed();
    return json(200, {
      ok: true,
      items: items.length,
      keptPrevious: !items.length && !!previous,
      tokenIssuedAt: current.issuedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/instagram] failed:', message);
    // The previous cache stays in place; the site keeps showing the last good feed.
    return json(502, { ok: false, reason: message.slice(0, 300) });
  }
};
