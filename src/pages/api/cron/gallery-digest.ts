import type { APIRoute } from 'astro';
import { getGallerySection } from '../../../lib/cms';
import { notifyOwner } from '../../../lib/notify';

export const prerender = false;

// Weekly, not a real-time push — see vercel.json's cron entry (Mondays,
// same CRON_SECRET-gated pattern as api/cron/instagram.ts). Summarizes
// what a busy single-owner business actually needs to act on, so checking
// the full /admin/gallery/ dashboard isn't something the owner has to
// remember to do.
const LAPSE_DAYS = 60;
const ENGAGED_VIEWS_THRESHOLD = 5;
const TOP_N = 5;

function unauthorized(): Response {
  return new Response('Unauthorized', { status: 401 });
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

export const GET: APIRoute = async ({ request }) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return unauthorized();

  const section = await getGallerySection();
  const pending = section.visitors.filter((v) => v.status === 'pending');
  const approved = section.visitors.filter((v) => v.status === 'approved');

  const topEngaged = [...approved].sort((a, b) => b.totalViews - a.totalViews).slice(0, TOP_N);
  const lapsing = approved.filter((v) => {
    const days = daysSince(v.lastVisitAt ?? v.approvedAt);
    return days !== null && days >= LAPSE_DAYS;
  });
  const engagedNoContact = approved.filter((v) => v.totalViews >= ENGAGED_VIEWS_THRESHOLD && !v.contactedAt);

  // Nothing to say this week — skip the email rather than send an empty one every Monday.
  if (pending.length === 0 && topEngaged.every((v) => v.totalViews === 0) && lapsing.length === 0 && engagedNoContact.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const lines: string[] = ['Your weekly private gallery summary:', ''];

  if (pending.length > 0) {
    lines.push(`${pending.length} request${pending.length === 1 ? '' : 's'} awaiting review:`);
    pending.forEach((v) => lines.push(`  - ${v.name} (${v.email})`));
    lines.push('');
  }

  const activeTop = topEngaged.filter((v) => v.totalViews > 0);
  if (activeTop.length > 0) {
    lines.push('Most engaged this week:');
    activeTop.forEach((v) => lines.push(`  - ${v.name}: ${v.totalViews} view${v.totalViews === 1 ? '' : 's'}`));
    lines.push('');
  }

  if (engagedNoContact.length > 0) {
    lines.push("Engaged but haven't reached out:");
    engagedNoContact.forEach((v) => lines.push(`  - ${v.name} (${v.totalViews} views, no contact yet)`));
    lines.push('');
  }

  if (lapsing.length > 0) {
    lines.push(`Gone quiet (${LAPSE_DAYS}+ days since their last visit):`);
    lapsing.forEach((v) => lines.push(`  - ${v.name} (last seen ${daysSince(v.lastVisitAt ?? v.approvedAt)} days ago)`));
    lines.push('');
  }

  lines.push('Review it all at: https://www.protectiondogs.gr/admin/gallery/');

  await notifyOwner('Weekly gallery summary', lines.join('\n'));

  return new Response(JSON.stringify({ ok: true, sent: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
