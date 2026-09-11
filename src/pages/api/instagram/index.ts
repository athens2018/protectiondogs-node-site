import type { APIRoute } from 'astro';
import { readFeed } from '../../../lib/instagram-store';

export const prerender = false;

// Serves the cached feed written by /api/cron/instagram/. Never calls Meta
// itself, so page loads cannot hit Instagram rate limits, and the CDN keeps
// a copy for an hour so the function runs a handful of times a day at most.
export const GET: APIRoute = async () => {
  const feed = await readFeed();
  if (!feed || !feed.items?.length) {
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' },
    });
  }

  const ageHours = Math.round((Date.now() - new Date(feed.fetchedAt).getTime()) / 36e5);
  return new Response(JSON.stringify(feed), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      'X-Feed-Age-Hours': String(ageHours),
    },
  });
};
