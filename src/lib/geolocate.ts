// Best-effort IP -> city/country lookup for gallery access requests (see
// src/lib/cms.ts's GalleryVisitor.locationCountry/locationCity — a soft
// signal, not precise: a VPN or corporate proxy throws it off like any
// IP-based lookup). Uses ipapi.co's free, unauthenticated HTTPS endpoint —
// no API key, no new credential for the owner to create. Rate-limited on
// their side (1,000 lookups/day on the free tier), which is far more than
// this business's request volume; fails soft (returns nulls) on any error,
// timeout, or rate-limit response rather than blocking a request.
export interface Geolocation {
  country: string | null;
  city: string | null;
}

export async function geolocateIp(ip: string): Promise<Geolocation> {
  if (!ip || ip === 'unknown' || ip === '127.0.0.1' || ip === '::1') {
    return { country: null, city: null };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return { country: null, city: null };
    const data = (await res.json()) as { country_name?: string; city?: string; error?: boolean };
    if (data.error) return { country: null, city: null };
    return { country: data.country_name ?? null, city: data.city ?? null };
  } catch {
    return { country: null, city: null };
  }
}
