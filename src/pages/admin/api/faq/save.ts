import type { APIRoute } from 'astro';
import { waitUntil } from '@vercel/functions';
import { checkAdminAccess } from '../../../../lib/admin-auth';
import { getFaqSection, saveFaqSection, type FaqSection } from '../../../../lib/cms';
import { validateFaqSection } from '../../../../lib/faq-validate';
import { parseFaqForm } from '../../../../lib/faq-form-parse';
import { triggerDeploy } from '../../../../lib/deploy-hook';
import { translateLocalizedTree } from '../../../../lib/translate';
import { notifyOwner, sleep } from '../../../../lib/notify';

export const prerender = false;

const MAX_ITEMS = 20;
const REBUILD_SETTLE_MS = 45_000;

/**
 * Same pattern as src/pages/admin/api/dogs/save.ts's
 * backgroundTranslateAndSave: runs after the English-only save has already
 * redirected the owner, translates the whole FAQ section into the other 12
 * locales, re-saves (retrying on a version conflict), redeploys, then
 * emails the owner once the rebuild should be done. Kept alive past the
 * response via waitUntil.
 */
async function backgroundTranslateAndSave(): Promise<void> {
  let translatedAndRedeployed = false;
  try {
    const initial = await getFaqSection();
    const translated = await translateLocalizedTree(initial);

    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await getFaqSection();
      const result = await saveFaqSection({ ...latest, eyebrow: translated.eyebrow, heading: translated.heading, items: translated.items }, latest.version);
      if (result.ok) {
        await triggerDeploy();
        translatedAndRedeployed = true;
        break;
      }
      if (result.error !== 'stale') break;
    }
  } catch (err) {
    console.error('[admin/faq/save] background translation failed:', err instanceof Error ? err.message : String(err));
  }

  await sleep(REBUILD_SETTLE_MS);
  if (translatedAndRedeployed) {
    await notifyOwner(
      'protectiondogs.gr was just updated',
      'Your FAQ change should be live now, translated into every language.\n\nhttps://www.protectiondogs.gr/',
    );
  } else {
    await notifyOwner(
      'protectiondogs.gr was just updated (English only for now)',
      "Your FAQ change should be live now in English. Automatic translation into the other languages didn't finish this time, so those languages will show the English text as a fallback until it's retried.\n\nhttps://www.protectiondogs.gr/",
    );
  }
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

function withError(message: string): Response {
  return redirect(`/admin/faq/?error=${encodeURIComponent(message)}`);
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

  const raw = parseFaqForm(form, MAX_ITEMS);
  const result = validateFaqSection(raw);
  if (!result.ok) return withError(`Could not save: ${result.errors.join('; ')}`);

  const current = await getFaqSection();
  if (current.version !== expectedVersion) {
    return withError('Someone else changed this since you loaded the page. Reload and try again.');
  }

  const next: FaqSection = { ...current, ...result.section! };
  const saveResult = await saveFaqSection(next, expectedVersion);

  if (!saveResult.ok) {
    if (saveResult.error === 'stale') return withError('Someone else changed this since you loaded the page. Reload and try again.');
    if (saveResult.error === 'no-store') {
      return withError('The CMS storage isn\'t connected yet (CMS_BLOB_READ_WRITE_TOKEN_STORE_ID is not set) — nothing was saved.');
    }
    return withError('Save failed. Please try again.');
  }

  waitUntil(backgroundTranslateAndSave());

  const deployResult = await triggerDeploy();
  const deployParam = deployResult === 'triggered' ? '' : `&deploy=${deployResult}`;
  return redirect(`/admin/faq/?saved=1${deployParam}`);
};
