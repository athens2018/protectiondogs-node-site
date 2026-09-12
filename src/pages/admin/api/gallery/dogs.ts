import type { APIRoute } from 'astro';
import { checkAdminAccess } from '../../../../lib/admin-auth';
import { getDogsSection, getGallerySection, resolveLocaleString } from '../../../../lib/cms';

export const prerender = false;

/**
 * Everything the gallery upload form needs before it can render: the dog
 * id/name list for the "about which dog" picker, plus the gallery
 * section's current version (items.ts's upload/delete actions require it
 * for optimistic concurrency). The web admin page reads both server-side
 * directly; this JSON route exists for the portal native app's upload
 * screen, which has no server-rendered page to read them from.
 */
export const GET: APIRoute = async ({ request, cookies }) => {
  const access = checkAdminAccess(cookies, request.headers.get('authorization'));
  if (!access.ok) return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const [dogsSection, gallerySection] = await Promise.all([getDogsSection(), getGallerySection()]);
  const dogs = dogsSection.dogs
    .filter((d) => d.status !== 'placed')
    .map((d) => ({ id: d.id, name: resolveLocaleString(d.name, 'en') }));

  return new Response(
    JSON.stringify({ ok: true, dogs, galleryVersion: gallerySection.version }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};
