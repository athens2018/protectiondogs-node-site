import type { APIRoute } from 'astro';
import { waitUntil } from '@vercel/functions';
import { checkAdminAccess } from '../../../../lib/admin-auth';
import { getTestimonialsSection, saveTestimonialsSection, type TestimonialsSection } from '../../../../lib/cms';
import { validateTestimonialsList } from '../../../../lib/testimonials-validate';
import { parseTestimonialsForm } from '../../../../lib/testimonials-form-parse';
import { triggerDeploy } from '../../../../lib/deploy-hook';
import { notifyOwner, sleep } from '../../../../lib/notify';

export const prerender = false;

const MAX_ITEMS = 100;
const REBUILD_SETTLE_MS = 45_000;

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

function withError(message: string): Response {
  return redirect(`/admin/testimonials/?error=${encodeURIComponent(message)}`);
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const access = checkAdminAccess(cookies);
  if (!access.ok) return redirect('/admin/login/');

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return withError('Malformed submission.');
  }

  const versionRaw = form.get('version');
  const expectedVersion = Number(versionRaw);
  if (!Number.isFinite(expectedVersion)) return withError('Missing or invalid version.');

  const rawRows = parseTestimonialsForm(form, MAX_ITEMS);
  const result = validateTestimonialsList(rawRows);
  if (!result.ok) return withError(`Could not save: ${result.errors.join('; ')}`);

  const current = await getTestimonialsSection();
  if (current.version !== expectedVersion) {
    return withError('Someone else changed this since you loaded the page. Reload and try again.');
  }

  const next: TestimonialsSection = { ...current, items: result.items! };
  const saveResult = await saveTestimonialsSection(next, expectedVersion);

  if (!saveResult.ok) {
    if (saveResult.error === 'stale') return withError('Someone else changed this since you loaded the page. Reload and try again.');
    if (saveResult.error === 'no-store') {
      return withError('The CMS storage isn\'t connected yet (CMS_BLOB_READ_WRITE_TOKEN_STORE_ID is not set) — nothing was saved.');
    }
    return withError('Save failed. Please try again.');
  }

  // No translation step here (see src/lib/cms.ts's TestimonialEntry.quote
  // comment — these are someone else's exact words, never auto-rewritten),
  // so there's no background translate-then-redeploy phase like Dogs/FAQ.
  // Just redeploy and, after a settle delay, let the owner know it's live.
  const deployResult = await triggerDeploy();
  waitUntil(
    (async () => {
      await sleep(REBUILD_SETTLE_MS);
      await notifyOwner(
        'protectiondogs.gr was just updated',
        'Your testimonials change should be live now.\n\nhttps://www.protectiondogs.gr/',
      );
    })(),
  );

  const deployParam = deployResult === 'triggered' ? '' : `&deploy=${deployResult}`;
  return redirect(`/admin/testimonials/?saved=1${deployParam}`);
};
