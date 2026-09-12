import type { APIRoute } from 'astro';
import { checkAdminAccess } from '../../../../lib/admin-auth';
import { getDogsSection, saveDogsSection, type DogEntry, type DogsSection } from '../../../../lib/cms';
import { validateDogEntry } from '../../../../lib/dogs-validate';
import { parseDogForm } from '../../../../lib/dog-form-parse';
import { triggerDeploy } from '../../../../lib/deploy-hook';

export const prerender = false;

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

  const deployResult = await triggerDeploy();
  const deployParam = deployResult === 'triggered' ? '' : `&deploy=${deployResult}`;
  return redirect(`/admin/dogs/?saved=1${deployParam}`);
};
