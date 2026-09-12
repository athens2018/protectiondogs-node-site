import type { APIRoute } from 'astro';
import { waitUntil } from '@vercel/functions';
import { checkAdminAccess } from '../../../../lib/admin-auth';
import { getDogsSection, saveDogsSection, resolveLocaleString, type DogEntry, type DogsSection } from '../../../../lib/cms';
import { validateDogEntry } from '../../../../lib/dogs-validate';
import { parseDogForm } from '../../../../lib/dog-form-parse';
import { triggerDeploy } from '../../../../lib/deploy-hook';
import { translateDogEntry } from '../../../../lib/translate';
import { notifyOwner, sleep } from '../../../../lib/notify';

export const prerender = false;

/** How long to wait after triggering a rebuild before emailing "it's live" — not a real completion check (Deploy Hooks don't expose one; see the comment below), just comfortably past the ~20-30s rebuilds this project normally takes. */
const REBUILD_SETTLE_MS = 45_000;

/**
 * Runs after the English-only save has already redirected the owner back to
 * the dog list. Translates the just-saved dog into the other 12 locales and
 * writes that back, re-fetching the section and retrying on a version
 * conflict (another save landing in the meantime) so this never clobbers a
 * concurrent edit. Kept alive past the response via @vercel/functions'
 * waitUntil (see astro.config.mjs's maxDuration) — the owner's browser never
 * waits on this; the site just gets a second, translated deploy a little
 * after the first.
 *
 * Finishes by emailing the owner that the update is live. Vercel Deploy
 * Hooks don't expose a way to check whether the rebuild they triggered has
 * actually finished (there's no status endpoint for the job id they
 * return), so this waits a fixed, generous delay rather than actually
 * confirming — a real check would need the owner to create and store a
 * separate Vercel API token just for this.
 */
async function backgroundTranslateAndSave(dogId: string): Promise<void> {
  let dogName = dogId;
  let translatedAndRedeployed = false;

  try {
    const initial = await getDogsSection();
    const initialIndex = initial.dogs.findIndex((d) => d.id === dogId);
    if (initialIndex === -1) return; // dog was deleted/renamed before this ran — nothing left to translate or report on
    dogName = resolveLocaleString(initial.dogs[initialIndex].name, 'en');
    const translated = await translateDogEntry(initial.dogs[initialIndex]);

    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await getDogsSection();
      const latestIndex = latest.dogs.findIndex((d) => d.id === dogId);
      if (latestIndex === -1) return;
      const nextDogs = latest.dogs.map((d, i) => (i === latestIndex ? translated : d));
      const result = await saveDogsSection({ ...latest, dogs: nextDogs }, latest.version);
      if (result.ok) {
        await triggerDeploy();
        translatedAndRedeployed = true;
        break;
      }
      if (result.error !== 'stale') break;
    }
  } catch (err) {
    console.error('[admin/dogs/save] background translation failed:', err instanceof Error ? err.message : String(err));
  }

  await sleep(REBUILD_SETTLE_MS);
  if (translatedAndRedeployed) {
    await notifyOwner(
      'protectiondogs.gr was just updated',
      `Your change to "${dogName}" should be live now, translated into every language.\n\nhttps://www.protectiondogs.gr/`,
    );
  } else {
    await notifyOwner(
      'protectiondogs.gr was just updated (English only for now)',
      `Your change to "${dogName}" should be live now in English. Automatic translation into the other languages didn't finish this time, so those languages will show the English text as a fallback until it's retried.\n\nhttps://www.protectiondogs.gr/`,
    );
  }
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

function withError(returnTo: string, message: string): Response {
  const sep = returnTo.includes('?') ? '&' : '?';
  return redirect(`${returnTo}${sep}error=${encodeURIComponent(message)}`);
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const access = checkAdminAccess(cookies);
  if (!access.ok) return redirect('/admin/login/');

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return withError('/admin/dogs/', 'Malformed submission.');
  }

  const action = String(form.get('action') ?? '');
  const returnTo = String(form.get('returnTo') ?? '/admin/dogs/');
  const versionRaw = form.get('version');
  const expectedVersion = Number(versionRaw);
  if (!Number.isFinite(expectedVersion)) return withError(returnTo, 'Missing or invalid version.');

  const current = await getDogsSection();
  if (current.version !== expectedVersion) {
    return withError(returnTo, 'Someone else changed this since you loaded the page. Reload and try again.');
  }

  let nextDogs: DogEntry[];
  /** Set only for 'upsert' — triggers the background auto-translate pass below once the English save has succeeded. */
  let upsertedDogId: string | null = null;

  if (action === 'reorder') {
    let order: string[];
    try {
      order = JSON.parse(String(form.get('order') ?? '[]'));
    } catch {
      return withError(returnTo, 'Malformed reorder request.');
    }
    const currentIds = current.dogs.map((d) => d.id);
    const isPermutation = order.length === currentIds.length && currentIds.every((id) => order.includes(id));
    if (!isPermutation) return withError(returnTo, 'Reorder request did not match the current dog list.');
    const byId = new Map(current.dogs.map((d) => [d.id, d]));
    nextDogs = order.map((id) => byId.get(id)!);
  } else if (action === 'setStatus') {
    const id = String(form.get('id') ?? '');
    const status = String(form.get('status') ?? '');
    if (status !== 'available' && status !== 'future' && status !== 'placed') {
      return withError(returnTo, 'Invalid status.');
    }
    const found = current.dogs.some((d) => d.id === id);
    if (!found) return withError(returnTo, `No dog with id "${id}".`);
    nextDogs = current.dogs.map((d) => (d.id === id ? { ...d, status } : d));
  } else if (action === 'upsert') {
    const raw = parseDogForm(form);
    const result = validateDogEntry(raw);
    if (!result.ok) {
      return withError(returnTo, `Could not save: ${result.errors.join('; ')}`);
    }
    const dog = result.dog!;
    upsertedDogId = dog.id;
    const existingIndex = current.dogs.findIndex((d) => d.id === dog.id);
    if (existingIndex === -1) {
      nextDogs = [...current.dogs, dog];
    } else {
      nextDogs = current.dogs.map((d, i) => (i === existingIndex ? dog : d));
    }
  } else {
    return withError(returnTo, `Unknown action "${action}".`);
  }

  const next: DogsSection = { ...current, dogs: nextDogs };
  const result = await saveDogsSection(next, expectedVersion);

  if (!result.ok) {
    if (result.error === 'stale') return withError(returnTo, 'Someone else changed this since you loaded the page. Reload and try again.');
    if (result.error === 'no-store') {
      return withError(
        returnTo,
        'The CMS storage isn\'t connected yet (CMS_BLOB_READ_WRITE_TOKEN_STORE_ID is not set) — nothing was saved.',
      );
    }
    return withError(returnTo, 'Save failed. Please try again.');
  }

  if (upsertedDogId) {
    waitUntil(backgroundTranslateAndSave(upsertedDogId));
  }

  const deployResult = await triggerDeploy();
  const deployParam = deployResult === 'triggered' ? '' : `&deploy=${deployResult}`;
  return redirect(`/admin/dogs/?saved=1${deployParam}`);
};
