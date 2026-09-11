/* Protection Dogs GR — service worker.
 *
 * Purpose: make the site installable (Android "Add to Home screen" and the
 * Play Store wrapper) and usable on a poor connection while keeping pages
 * as fresh as the connection allows. Pages are network-first; the last
 * cached copy is used only when the network does not answer within the
 * timeout below or the visitor is offline, so on a very slow connection a
 * visitor can briefly see the previous version of a page (never an
 * arbitrarily old one: the copy is refreshed on every successful visit).
 *
 * Strategy
 *  - Page navigations: network first (3 s timeout), then the last cached
 *    copy of that page, then /offline.html. Nothing is precached except the
 *    offline page and the logo, so every visit with a connection shows the
 *    current site.
 *  - Same-origin static files (CSS, images, icons, manifest) and the
 *    versioned CDN files (Bootstrap, AOS, Font Awesome, Google Fonts):
 *    stale-while-revalidate — served from cache instantly, refreshed in the
 *    background.
 *  - Video, analytics, the enquiry form (Formspree), Testimonial.to and any
 *    other third party: never intercepted or cached.
 *
 * Bump CACHE_VERSION to drop every old cache on the next activation.
 */
const CACHE_VERSION = 'pdg-v4'; // v4: Node.js rebuild — every asset path changed, drop every earlier copy
const OFFLINE_URL = '/offline.html';
const PRECACHE_OPTIONAL = ['/images/logo.webp', '/app-icons/icon-192.png', '/site.webmanifest'];
const NAV_TIMEOUT_MS = 3000;
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const STATIC_RE = /\.(?:css|js|png|jpe?g|webp|avif|svg|ico|woff2?|ttf|webmanifest|json)(?:\?.*)?$/i;

self.addEventListener('install', function (event) {
    // Only the offline page is required for installation. The other
    // precache entries are best-effort: a missing or renamed asset must
    // never make the whole worker fail to install (that would silently
    // disable offline support and installability for every visitor).
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then(function (cache) {
                return cache.add(OFFLINE_URL).then(function () {
                    return Promise.all(PRECACHE_OPTIONAL.map(function (url) {
                        return cache.add(url).catch(function () {});
                    }));
                });
            })
            .then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys()
            .then(function (keys) {
                return Promise.all(keys.filter(function (k) { return k !== CACHE_VERSION; }).map(function (k) { return caches.delete(k); }));
            })
            .then(function () {
                if (self.registration.navigationPreload) {
                    return self.registration.navigationPreload.enable();
                }
            })
            .then(function () { return self.clients.claim(); })
    );
});

function isCdn(url) {
    return CDN_HOSTS.indexOf(url.hostname) !== -1;
}

function networkFirstPage(event) {
    return new Promise(function (resolve) {
        var settled = false;
        var timer = setTimeout(function () {
            if (settled) return;
            settled = true;
            caches.match(event.request).then(function (cached) {
                resolve(cached || caches.match(OFFLINE_URL));
            });
        }, NAV_TIMEOUT_MS);

        // cache: 'no-cache' = always revalidate with the server, so a page
        // that the browser's HTTP cache still holds under an old long
        // max-age can never be handed back as "fresh".
        Promise.resolve(event.preloadResponse).then(function (preloaded) {
            return preloaded || fetch(event.request, { cache: 'no-cache' });
        }).then(function (response) {
            if (response && response.ok) {
                var copy = response.clone();
                caches.open(CACHE_VERSION).then(function (cache) { cache.put(event.request, copy); });
            }
            if (settled) return; // the timeout already answered; cache is updated for next time
            settled = true;
            clearTimeout(timer);
            resolve(response);
        }).catch(function () {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            caches.match(event.request).then(function (cached) {
                resolve(cached || caches.match(OFFLINE_URL));
            });
        });
    });
}

function staleWhileRevalidate(request) {
    return caches.open(CACHE_VERSION).then(function (cache) {
        return cache.match(request).then(function (cached) {
            var network = fetch(request, { cache: 'no-cache' }).then(function (response) {
                if (response && (response.ok || response.type === 'opaque')) {
                    cache.put(request, response.clone());
                }
                return response;
            }).catch(function () { return cached; });
            return cached || network;
        });
    });
}

self.addEventListener('fetch', function (event) {
    var request = event.request;
    if (request.method !== 'GET') return;
    var url = new URL(request.url);

    if (request.mode === 'navigate') {
        event.respondWith(networkFirstPage(event));
        return;
    }
    if (url.origin === self.location.origin) {
        if (/\.(?:mp4|webm)$/i.test(url.pathname) || url.pathname === '/sw.js') return; // range requests and the worker itself: straight to network
        if (STATIC_RE.test(url.pathname + url.search)) {
            event.respondWith(staleWhileRevalidate(request));
        }
        return;
    }
    if (isCdn(url) && request.destination !== '') {
        event.respondWith(staleWhileRevalidate(request));
    }
    // everything else (analytics, Formspree, Testimonial.to, WhatsApp...) is untouched
});
