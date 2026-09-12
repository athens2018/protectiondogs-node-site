# Cutover runbook — protectiondogs.gr → node-site

Everything up to "DNS cutover" here is safe, reversible, and already done
or repeatable at any time. The DNS step is the one genuinely irreversible
moment — it's isolated at the end on purpose, and nothing before it
requires touching the live site or its DNS.

## Current state (as of 2026-09-12)

- Live production site: unchanged, still the original static
  HTML/Bootstrap site at `https://www.protectiondogs.gr`, served from
  Plesk/Apache. Nothing in this project has touched it.
- Rebuild: `Website/node-site/`, deployed and live at the **stable**
  Vercel alias `https://node-site-pdg3.vercel.app/` (team `pdg3`, project
  `node-site`). Deployment protection is off — anyone with the link can
  view it. This is not the production domain; it's a fully isolated
  preview that happens to be a real, permanent Vercel deployment rather
  than a throwaway one.
- Do not hand anyone a `node-site-<hash>-pdg3.vercel.app` URL — those are
  pinned forever to one build and will never reflect new commits. Always
  use the stable alias above.

## Before cutover — final checklist

- [ ] Owner review on desktop AND a real phone against the content
      inventory (every section, every language spot-checked, not just
      English) — genuinely look at it, don't rubber-stamp.
- [ ] Explicit sign-off on the visual/premium direction.
- [ ] Decide the Instagram feed: set `INSTAGRAM_ACCESS_TOKEN` (see
      `src/pages/api/cron/instagram.ts`'s own comments) or leave it
      permanently hidden — it degrades gracefully either way, this is a
      "whenever," not a blocker.
- [ ] Translate the Formspree→Resend privacy-policy paragraph properly in
      the 12 non-English locales if it hasn't been done by a native
      speaker yet (English is correct; the other 12 were AI-translated
      as a stopgap — see the commit that introduced them).
- [ ] Re-run Lighthouse/accessibility once more against the stable alias
      right before cutover, since more commits have landed since the
      first pass (this file's own history: `git log --oneline` in
      `node-site/` shows what's changed).
- [ ] Confirm the Resend `RESEND_API_KEY` env var used by
      `src/pages/api/enquiry.ts` is the *production* key (it already is —
      `vercel env ls --scope pdg3` should show it under `node-site`, not
      reused from the portal project).

## Step 1 — Deploy runbook rehearsal (no risk, do this first)

```bash
cd Website/node-site
vercel whoami --scope pdg3          # must print kz2023-3961, never apoulos78
npm run build                        # must be clean, ~30 routes
vercel --prod --yes --scope pdg3     # deploys to the stable alias
curl -sI https://node-site-pdg3.vercel.app/ | head -5   # 200, real headers
```

## Step 2 — Add the apex/www domains to the Vercel project (still zero live impact)

This makes Vercel *aware* of the domains and issues TLS for them, but
**does nothing to live traffic** until Step 3's DNS change actually
points visitors there — Vercel simply won't receive any requests for
`protectiondogs.gr` until the DNS record says so.

```bash
vercel domains add protectiondogs.gr --scope pdg3
vercel domains add www.protectiondogs.gr --scope pdg3
```
Vercel will show a "pending verification" state until Step 3. That's expected.

## Step 3 — DNS cutover (the one irreversible step — do this last, deliberately)

**Only through Plesk's own DNS Settings panel** — Websites & Domains →
`protectiondogs.gr` → Hosting & DNS → DNS. Never the registrar's separate
"DNS Zone" editor or "DNS4FREE" screen — both look real but don't sync to
the live zone (this caused a real incident once already: a toggle there
wiped its record list, and re-saving values there never moved the live
zone despite claiming pending changes).

Change only these two records, in that same zone, leaving everything
else untouched:
- Root `A` record: from `15.235.109.155` (current Plesk server) to
  Vercel's apex IP (get the exact current value from
  `vercel domains inspect protectiondogs.gr --scope pdg3` after Step 2 —
  don't hardcode a value here that Vercel might change).
- `www` `CNAME`: to Vercel's target (same command shows this).

Leave untouched, in the same zone: `mail` A record, root `MX`, SPF TXT,
`portal` A record (the client portal), `send`/`resend._domainkey` (Resend
sending records). None of these are Vercel-related and none should move.

Verify against the real authoritative nameserver directly, not a public
resolver and not this machine's own resolver (a stale local cache is
exactly what caused a false "site is down" scare during the portal's own
DNS work):
```bash
nslookup -type=A protectiondogs.gr ns214.easy.gr
nslookup -type=A www.protectiondogs.gr ns214.easy.gr
```

## Step 4 — TLS

Based on the portal subdomain's own precedent, Vercel's automatic
provisioning may not trigger on its own. If `https://www.protectiondogs.gr`
doesn't show a valid cert within a few minutes of DNS propagating:
```bash
vercel certs issue protectiondogs.gr --scope pdg3
vercel certs issue www.protectiondogs.gr --scope pdg3
```

## Step 5 — Post-cutover production QA (do this for real, not from memory)

- Fresh session + repeat session, root and several localized URLs.
- Every old-URL redirect still works (the 57 legacy redirects +
  `/sitemap.xml`).
- Mobile hero fail-safe (JS off, 320px).
- Section dots, language switching, phase media, CTA preselection.
- One real enquiry submission end-to-end (check it actually arrives).
- Conversion events firing (check GA4 real-time if analytics consent is
  accepted).
- `404`, `robots.txt`, `sitemap-index.xml`.
- Console/network clean on a real, fresh browser profile.
- **`mail.protectiondogs.gr` email still works** — easy to assume DNS is
  fine just because the site loads; verify this specifically since it's
  a separate record that's easy to silently break if Step 3 touches
  anything beyond the two records listed there.
- Update `PROGRESS.md` (or wherever the live site's own tracker lives)
  with the true post-cutover state.

## Rollback

If anything is materially wrong after cutover: revert Step 3's two DNS
records back to the original values (root `A` → `15.235.109.155`, `www`
CNAME → whatever it pointed at before — check `git log`/this file's own
history, or Plesk's DNS panel usually keeps recent values visible before
a change). The original Apache/Plesk site was never modified, so it
serves correctly again the moment DNS points back at it. No application
rollback is needed — only the DNS step.
