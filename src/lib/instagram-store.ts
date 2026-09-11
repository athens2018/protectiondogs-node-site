import { get, put } from '@vercel/blob';

// One private Blob store holds both the cached feed and the rotating
// long-lived token. The feed is only ever served through /api/instagram/,
// so nothing here needs to be publicly addressable.
export const FEED_PATH = 'instagram/feed.json';
export const TOKEN_PATH = 'instagram/token.json';

export interface FeedItem {
  id: string;
  permalink: string;
  image: string;
  timestamp: string;
}

export interface FeedPayload {
  items: FeedItem[];
  fetchedAt: string;
}

export interface StoredToken {
  accessToken: string;
  /** ISO timestamp of when this token was issued or last refreshed */
  issuedAt: string;
}

async function readJson<T>(pathname: string): Promise<T | null> {
  try {
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const text = await new Response(result.stream).text();
    return JSON.parse(text) as T;
  } catch (err) {
    // A missing blob is the normal first-run state; anything else is logged.
    const message = err instanceof Error ? err.message : String(err);
    if (!/not.?found|404/i.test(message)) console.error(`[instagram-store] read ${pathname} failed:`, message);
    return null;
  }
}

async function writeJson(pathname: string, value: unknown): Promise<void> {
  await put(pathname, JSON.stringify(value), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

export const readFeed = () => readJson<FeedPayload>(FEED_PATH);
export const writeFeed = (feed: FeedPayload) => writeJson(FEED_PATH, feed);
export const readToken = () => readJson<StoredToken>(TOKEN_PATH);
export const writeToken = (token: StoredToken) => writeJson(TOKEN_PATH, token);
