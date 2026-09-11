interface FeedItem {
  id: string;
  permalink: string;
  image: string;
}

interface FeedPayload {
  items: FeedItem[];
  fetchedAt?: string;
}

const MAX_TILES = 6;
const ICON =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="3.8"/><circle cx="17" cy="7" r=".9" fill="currentColor" stroke="none"/></svg>';

// The section starts hidden and only appears once real posts arrive from
// the cached feed. Any failure (no cache yet, endpoint down, offline) leaves
// the page exactly as it was — the feed is an enhancement, never a dependency.
export function initInstagram(): void {
  const section = document.getElementById('instagram');
  const grid = section?.querySelector<HTMLUListElement>('[data-ig-grid]');
  if (!section || !grid) return;

  fetch('/api/instagram/', { headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? (res.json() as Promise<FeedPayload>) : null))
    .then((payload) => {
      const items = payload?.items?.filter((i) => i && i.image && i.permalink).slice(0, MAX_TILES) ?? [];
      if (!items.length) return;

      const frag = document.createDocumentFragment();
      for (const item of items) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'ig-tile';
        a.href = item.permalink;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.setAttribute('aria-label', 'Instagram');
        const img = document.createElement('img');
        img.src = item.image;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.width = 400;
        img.height = 400;
        a.appendChild(img);
        const icon = document.createElement('span');
        icon.className = 'ig-tile__icon';
        icon.innerHTML = ICON;
        a.appendChild(icon);
        li.appendChild(a);
        frag.appendChild(li);
      }
      grid.replaceChildren(frag);
      section.hidden = false;
    })
    .catch(() => {
      /* stay hidden */
    });
}
