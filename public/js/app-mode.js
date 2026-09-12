/* Protection Dogs GR — app layer.
 *
 * Two parts:
 *  1. APP MODE — only when the site runs as the installed app (Play Store
 *     wrapper / "Add to Home screen"): bottom tab bar built from the page's
 *     own primary navigation, auto-hiding compact header, a direct-contact
 *     sheet, share action on the dog card, offline/online toasts, haptic
 *     ticks. Never active in a normal browser tab (preview: /?app=1).
 *  2. INSTALL PROMPT — in a normal browser that can install the app
 *     (Android Chrome, desktop Chrome/Edge): a dismissible strip offering
 *     the install. Dismissal is remembered for 30 days.
 *
 * Every label is either taken from the page itself (already localized) or
 * from the STRINGS table below (13 languages). Contact targets are read
 * from the page's own footer links, never hard-coded twice.
 */
(function () {
    'use strict';

    var STRINGS = {
        en: { call: 'Call', contact: 'Direct contact', share: 'Share', copied: 'Link copied', offline: "You're offline. Showing the last loaded version.", online: 'Back online', install: 'Install the Protection Dogs GR app', installBtn: 'Install', later: 'Not now', close: 'Close' },
        el: { call: 'Κλήση', contact: 'Άμεση επικοινωνία', share: 'Κοινοποίηση', copied: 'Ο σύνδεσμος αντιγράφηκε', offline: 'Είστε εκτός σύνδεσης. Εμφανίζεται η τελευταία φορτωμένη έκδοση.', online: 'Ξανά σε σύνδεση', install: 'Εγκαταστήστε την εφαρμογή Protection Dogs GR', installBtn: 'Εγκατάσταση', later: 'Όχι τώρα', close: 'Κλείσιμο' },
        de: { call: 'Anrufen', contact: 'Direkter Kontakt', share: 'Teilen', copied: 'Link kopiert', offline: 'Sie sind offline. Es wird die zuletzt geladene Version angezeigt.', online: 'Wieder online', install: 'Protection Dogs GR App installieren', installBtn: 'Installieren', later: 'Nicht jetzt', close: 'Schließen' },
        fr: { call: 'Appeler', contact: 'Contact direct', share: 'Partager', copied: 'Lien copié', offline: 'Vous êtes hors ligne. Affichage de la dernière version chargée.', online: 'De retour en ligne', install: "Installer l'application Protection Dogs GR", installBtn: 'Installer', later: 'Pas maintenant', close: 'Fermer' },
        ar: { call: 'اتصال', contact: 'تواصل مباشر', share: 'مشاركة', copied: 'تم نسخ الرابط', offline: 'أنت غير متصل بالإنترنت. يتم عرض آخر نسخة تم تحميلها.', online: 'عاد الاتصال', install: 'ثبّت تطبيق Protection Dogs GR', installBtn: 'تثبيت', later: 'ليس الآن', close: 'إغلاق' },
        es: { call: 'Llamar', contact: 'Contacto directo', share: 'Compartir', copied: 'Enlace copiado', offline: 'Estás sin conexión. Se muestra la última versión cargada.', online: 'De nuevo en línea', install: 'Instala la aplicación Protection Dogs GR', installBtn: 'Instalar', later: 'Ahora no', close: 'Cerrar' },
        zh: { call: '致电', contact: '直接联系', share: '分享', copied: '链接已复制', offline: '您已离线，正在显示最近加载的版本。', online: '已重新连接', install: '安装 Protection Dogs GR 应用', installBtn: '安装', later: '暂不', close: '关闭' },
        ru: { call: 'Позвонить', contact: 'Прямая связь', share: 'Поделиться', copied: 'Ссылка скопирована', offline: 'Вы не в сети. Показана последняя загруженная версия.', online: 'Снова в сети', install: 'Установить приложение Protection Dogs GR', installBtn: 'Установить', later: 'Не сейчас', close: 'Закрыть' },
        tr: { call: 'Ara', contact: 'Doğrudan iletişim', share: 'Paylaş', copied: 'Bağlantı kopyalandı', offline: 'Çevrimdışısınız. En son yüklenen sürüm gösteriliyor.', online: 'Yeniden çevrimiçi', install: 'Protection Dogs GR uygulamasını yükleyin', installBtn: 'Yükle', later: 'Şimdi değil', close: 'Kapat' },
        it: { call: 'Chiama', contact: 'Contatto diretto', share: 'Condividi', copied: 'Link copiato', offline: "Sei offline. Viene mostrata l'ultima versione caricata.", online: 'Di nuovo online', install: "Installa l'app Protection Dogs GR", installBtn: 'Installa', later: 'Non ora', close: 'Chiudi' },
        pt: { call: 'Ligar', contact: 'Contacto direto', share: 'Partilhar', copied: 'Ligação copiada', offline: 'Está offline. A mostrar a última versão carregada.', online: 'Novamente online', install: 'Instale a aplicação Protection Dogs GR', installBtn: 'Instalar', later: 'Agora não', close: 'Fechar' },
        nl: { call: 'Bellen', contact: 'Direct contact', share: 'Delen', copied: 'Link gekopieerd', offline: 'Je bent offline. De laatst geladen versie wordt getoond.', online: 'Weer online', install: 'Installeer de Protection Dogs GR-app', installBtn: 'Installeren', later: 'Niet nu', close: 'Sluiten' },
        ja: { call: '電話する', contact: '直接のご連絡', share: '共有', copied: 'リンクをコピーしました', offline: 'オフラインです。最後に読み込んだ内容を表示しています。', online: 'オンラインに戻りました', install: 'Protection Dogs GR アプリをインストール', installBtn: 'インストール', later: '今はしない', close: '閉じる' }
    };
    var lang = (document.documentElement.lang || 'en').slice(0, 2).toLowerCase();
    var T = STRINGS[lang] || STRINGS.en;
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function el(tag, className, text) {
        var e = document.createElement(tag);
        if (className) e.className = className;
        if (text != null) e.textContent = text;
        return e;
    }
    function icon(name) {
        var i = el('i', 'fas ' + name);
        i.setAttribute('aria-hidden', 'true');
        return i;
    }
    function tick() { // subtle haptic feedback on the phone; silently ignored elsewhere
        try { if (navigator.vibrate) navigator.vibrate(6); } catch (e) {}
    }
    var store = null;
    try { store = window.localStorage; } catch (e) {}
    var session = null;
    try { session = window.sessionStorage; } catch (e) {}

    /* ------------------------------------------------------------------ */
    /* Toasts (used by app mode and by the share fallback)                   */
    var toastEl = null, toastTimer = null;
    function toast(message, sticky) {
        if (!toastEl) {
            toastEl = el('div', 'app-toast');
            toastEl.setAttribute('role', 'status');
            toastEl.setAttribute('aria-live', 'polite');
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = message;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        if (!sticky) toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
    }
    function hideToast() { if (toastEl) toastEl.classList.remove('show'); }

    /* ------------------------------------------------------------------ */
    /* Contact targets, read from the page's own footer links                */
    function contactTargets() {
        var footer = document.querySelector('footer') || document;
        var wa = footer.querySelector('a[href^="https://wa.me/"]');
        var mail = footer.querySelector('a[href^="mailto:"]');
        var digits = wa ? (wa.getAttribute('href').match(/wa\.me\/(\d+)/) || [])[1] : null;
        var enquire = document.querySelector('nav.navbar .nav-link[href$="#contact"]');
        return {
            whatsapp: wa && { href: wa.getAttribute('href'), label: wa.getAttribute('aria-label') || 'WhatsApp' },
            call: digits && { href: 'tel:+' + digits, label: T.call },
            email: mail && { href: mail.getAttribute('href'), label: mail.getAttribute('aria-label') || 'Email' },
            enquire: enquire && { href: enquire.getAttribute('href'), label: enquire.textContent.trim() }
        };
    }

    /* ------------------------------------------------------------------ */
    /* APP MODE                                                              */
    var mm = window.matchMedia;
    var preview = /[?&]app=1(?:&|$)/.test(window.location.search);
    var isApp = (mm && (mm('(display-mode: standalone)').matches || mm('(display-mode: fullscreen)').matches))
        || navigator.standalone === true // iOS Safari "Add to Home Screen" PWA launch — not the native wrapper below
        || (document.referrer || '').indexOf('android-app://gr.protectiondogs.app') === 0
        // The iOS native wrapper (Website/ios-app) is a plain WKWebView, not a
        // Safari PWA, so it gets none of the checks above — Android's
        // referrer scheme has no WKWebView equivalent. It identifies itself
        // with a UA suffix instead (App.tsx sets this explicitly); do the
        // same startsWith-style substring check as the Android line above,
        // not a version-sensitive exact match.
        || /PDGiOSApp\//.test(navigator.userAgent || '')
        || preview
        || (session && session.getItem('pdg-app-mode') === '1');

    function buildTabBar() {
        if (document.querySelector('.app-tabbar')) return;
        var nav = document.querySelector('nav.navbar');
        if (!nav) return;
        var links = Array.prototype.filter.call(nav.querySelectorAll('.nav-link[href]'), function (a) {
            return /#[a-z-]+$/.test(a.getAttribute('href'));
        });
        if (!links.length) return;
        var ICONS = { dogs: 'fa-paw', training: 'fa-graduation-cap', breeding: 'fa-dna', pricing: 'fa-tag', about: 'fa-user', contact: 'fa-envelope' };
        var bar = el('nav', 'app-tabbar');
        bar.setAttribute('aria-label', nav.getAttribute('aria-label') || 'Menu');
        links.forEach(function (a) {
            var href = a.getAttribute('href');
            var id = href.split('#')[1];
            var tab = el('a', 'app-tab');
            tab.href = href;
            tab.setAttribute('data-section', id);
            tab.appendChild(icon(ICONS[id] || 'fa-circle'));
            tab.appendChild(el('span', null, a.textContent.trim()));
            tab.addEventListener('click', function (ev) {
                tick();
                var target = document.getElementById(id);
                if (!target) return; // standalone page: follow the link to /#section
                ev.preventDefault();
                target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
                try { history.replaceState(null, '', '#' + id); } catch (e) {}
            });
            bar.appendChild(tab);
        });
        document.body.appendChild(bar);

        // Fit the labels: shrink the whole row's font in small steps before
        // ever breaking a word (long single words in Greek, Spanish,
        // Russian...). Word breaking stays the very last resort.
        function fitLabels() {
            var spans = bar.querySelectorAll('.app-tab span');
            var overflowing = function () {
                return Array.prototype.some.call(spans, function (s) { return s.scrollWidth > s.clientWidth + 1; });
            };
            bar.classList.remove('app-tabbar-wrap');
            var steps = ['0.58rem', '0.55rem', '0.52rem', '0.5rem'];
            for (var i = 0; i < steps.length; i++) {
                bar.style.fontSize = steps[i];
                if (!overflowing()) return;
            }
            bar.classList.add('app-tabbar-wrap');
        }
        fitLabels();
        window.addEventListener('resize', fitLabels);

        var tabs = bar.querySelectorAll('.app-tab');
        var sections = Array.prototype.map.call(tabs, function (t) { return document.getElementById(t.getAttribute('data-section')); }).filter(Boolean);
        if (sections.length && 'IntersectionObserver' in window) {
            var io = new IntersectionObserver(function (entries) {
                entries.forEach(function (e) {
                    if (!e.isIntersecting) return;
                    Array.prototype.forEach.call(tabs, function (t) {
                        var on = t.getAttribute('data-section') === e.target.id;
                        t.classList.toggle('active', on);
                        if (on) t.setAttribute('aria-current', 'location'); else t.removeAttribute('aria-current');
                    });
                });
            }, { rootMargin: '-35% 0px -55% 0px' });
            sections.forEach(function (s) { io.observe(s); });
        }
    }

    // Header hides on scroll down and returns on scroll up (native pattern);
    // never while the hamburger menu or the language sheet is open.
    function autoHideHeader() {
        var nav = document.querySelector('nav.navbar');
        if (!nav) return;
        var last = window.pageYOffset, ticking = false;
        function isMenuOpen() {
            var collapse = document.getElementById('navbarNav');
            var drawer = document.getElementById('langDrawer');
            return (collapse && collapse.classList.contains('show')) || (drawer && drawer.classList.contains('open')) || document.querySelector('.app-sheet.open');
        }
        window.addEventListener('scroll', function () {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(function () {
                var y = window.pageYOffset;
                if (isMenuOpen() || y < 80) {
                    document.documentElement.classList.remove('app-nav-hidden');
                } else if (y > last + 6) {
                    document.documentElement.classList.add('app-nav-hidden');
                } else if (y < last - 6) {
                    document.documentElement.classList.remove('app-nav-hidden');
                }
                last = y;
                ticking = false;
            });
        }, { passive: true });
    }

    // Direct-contact sheet behind a concierge button in the header.
    function buildConcierge() {
        var controls = document.querySelector('nav.navbar .mobile-nav-controls');
        var toggler = controls && controls.querySelector('.navbar-toggler');
        if (!controls || document.querySelector('.app-concierge')) return;
        var c = contactTargets();
        var rows = [
            c.whatsapp && { href: c.whatsapp.href, label: c.whatsapp.label, icon: 'fab fa-whatsapp', external: true },
            c.call && { href: c.call.href, label: c.call.label, icon: 'fas fa-phone' },
            c.email && { href: c.email.href, label: c.email.label, icon: 'fas fa-envelope' },
            c.enquire && { href: c.enquire.href, label: c.enquire.label, icon: 'fas fa-pen' }
        ].filter(Boolean);
        if (!rows.length) return;

        var btn = el('button', 'app-concierge');
        btn.type = 'button';
        btn.setAttribute('aria-label', T.contact);
        btn.setAttribute('aria-haspopup', 'dialog');
        btn.setAttribute('aria-expanded', 'false');
        btn.appendChild(icon('fa-headset'));
        controls.insertBefore(btn, toggler || null);

        var backdrop = el('div', 'app-sheet-backdrop');
        var sheet = el('div', 'app-sheet');
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-modal', 'true');
        sheet.setAttribute('aria-label', T.contact);
        var head = el('div', 'app-sheet-head');
        head.appendChild(el('p', 'app-sheet-title', T.contact));
        var close = el('button', 'app-sheet-close');
        close.type = 'button';
        close.setAttribute('aria-label', T.close);
        close.innerHTML = '&times;';
        head.appendChild(close);
        sheet.appendChild(head);
        rows.forEach(function (r) {
            var a = el('a', 'app-sheet-row');
            a.href = r.href;
            if (r.external) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
            var ic = el('i', r.icon); ic.setAttribute('aria-hidden', 'true');
            a.appendChild(ic);
            a.appendChild(el('span', null, r.label));
            a.addEventListener('click', function () { tick(); closeSheet(); });
            sheet.appendChild(a);
        });
        document.body.appendChild(backdrop);
        document.body.appendChild(sheet);

        function openSheet() {
            backdrop.classList.add('open');
            sheet.classList.add('open');
            btn.setAttribute('aria-expanded', 'true');
            document.documentElement.classList.remove('app-nav-hidden');
            tick();
            var first = sheet.querySelector('.app-sheet-row');
            // the sheet becomes focusable only after the style recalc that
            // applies .open, so hand focus over on the next frame
            if (first) setTimeout(function () { first.focus(); }, 40);
        }
        function closeSheet() {
            backdrop.classList.remove('open');
            sheet.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');
            btn.focus(); // focus always returns to the trigger, never stays inside the hidden sheet
        }
        btn.addEventListener('click', function () { sheet.classList.contains('open') ? closeSheet() : openSheet(); });
        close.addEventListener('click', closeSheet);
        backdrop.addEventListener('click', closeSheet);
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && sheet.classList.contains('open')) closeSheet();
        });
    }

    // Share the dog card (Web Share on the phone, copy-link elsewhere).
    function buildShare() {
        var meet = document.querySelector('.dog-profile-card .btn-meet-dog');
        if (!meet || document.querySelector('.app-share')) return;
        if (!navigator.share && !(navigator.clipboard && navigator.clipboard.writeText)) return;
        var b = el('button', 'btn-meet-dog app-share mb-4');
        b.type = 'button';
        b.appendChild(icon('fa-share-nodes'));
        b.appendChild(document.createTextNode(' ' + T.share));
        b.addEventListener('click', function (ev) {
            ev.stopPropagation();
            tick();
            var url = location.origin + location.pathname + '#dogs';
            var title = document.title;
            var lead = meet.closest('.dog-profile-card') && meet.closest('.dog-profile-card').querySelector('p');
            var text = lead ? lead.textContent.trim() : '';
            if (navigator.share) {
                navigator.share({ title: title, text: text, url: url }).catch(function () {});
            } else {
                navigator.clipboard.writeText(url).then(function () { toast(T.copied); }).catch(function () {});
            }
        });
        meet.insertAdjacentElement('afterend', b);
    }

    function connectivityToasts() {
        window.addEventListener('offline', function () { toast(T.offline, true); });
        window.addEventListener('online', function () { hideToast(); toast(T.online); });
        if (navigator.onLine === false) toast(T.offline, true);
    }

    function startAppMode() {
        try { session && session.setItem('pdg-app-mode', '1'); } catch (e) {}
        document.documentElement.classList.add('app-mode');
        buildTabBar();
        autoHideHeader();
        buildConcierge();
        buildShare();
        connectivityToasts();
    }

    /* ------------------------------------------------------------------ */
    /* INSTALL PROMPT (browser only)                                          */
    var DISMISS_KEY = 'pdg-install-dismissed';
    function installPrompt() {
        var deferred = null;
        window.addEventListener('beforeinstallprompt', function (e) {
            e.preventDefault();
            deferred = e;
            var dismissedAt = 0;
            try { dismissedAt = parseInt(store && store.getItem(DISMISS_KEY), 10) || 0; } catch (err) {}
            if (Date.now() - dismissedAt < 30 * 24 * 3600 * 1000) return;
            if (document.querySelector('.app-install-bar')) return;
            var bar = el('div', 'app-install-bar');
            bar.setAttribute('role', 'region');
            bar.setAttribute('aria-label', T.install);
            bar.appendChild(el('p', 'app-install-text', T.install));
            var actions = el('div', 'app-install-actions');
            var later = el('button', 'app-install-later', T.later); later.type = 'button';
            var go = el('button', 'app-install-go', T.installBtn); go.type = 'button';
            actions.appendChild(later); actions.appendChild(go);
            bar.appendChild(actions);
            // Final website pass (P0 hero): the strip must never cover the
            // hero copy or its buttons on a first visit (on a 568px-tall
            // phone it sat exactly over the CTAs). It appears once the
            // visitor has scrolled past the hero, or after 12 s at the latest.
            var revealed = false;
            function reveal() {
                if (revealed) return;
                revealed = true;
                window.removeEventListener('scroll', onScroll);
                document.body.appendChild(bar);
                requestAnimationFrame(function () { bar.classList.add('show'); });
            }
            function onScroll() {
                var hero = document.querySelector('.hero');
                var pastHero = hero ? (hero.getBoundingClientRect().bottom <= window.innerHeight * 0.5) : (window.scrollY > 300);
                if (pastHero) reveal();
            }
            window.addEventListener('scroll', onScroll, { passive: true });
            setTimeout(reveal, 12000);
            function hide() { revealed = true; window.removeEventListener('scroll', onScroll); bar.classList.remove('show'); setTimeout(function () { bar.remove(); }, 400); }
            later.addEventListener('click', function () {
                try { store && store.setItem(DISMISS_KEY, String(Date.now())); } catch (err) {}
                hide();
            });
            go.addEventListener('click', function () {
                hide();
                if (deferred && deferred.prompt) {
                    deferred.prompt();
                    if (deferred.userChoice) deferred.userChoice.then(function () { deferred = null; });
                }
            });
        });
        window.addEventListener('appinstalled', function () {
            var bar = document.querySelector('.app-install-bar');
            if (bar) bar.remove();
        });
    }

    function init() {
        if (isApp) startAppMode(); else installPrompt();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
