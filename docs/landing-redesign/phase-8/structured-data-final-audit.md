# Phase 8 Structured Data, Open Graph, and Icons/Manifest Final Audit

## Structured data

Verified via direct HTML fetch against the live production build (port 3050) — real JSON-LD block counts per representative route (not assumed from source alone):

| Route | JSON-LD blocks | Types present (per Phase 4-6 architecture, re-confirmed) |
|---|---|---|
| `/` | 8 | `Organization`, `WebSite`, plus page-specific blocks |
| `/modules/manufacturing` | 10 | Includes `BreadcrumbList`, module-page schema |
| `/resources/erp-buying-guide` | 10 | Includes `TechArticle`, `FAQPage`, `BreadcrumbList` |
| `/resources/glossary/erp` | 10 | Includes `DefinedTerm`-family schema, `BreadcrumbList` |
| `/compare/vercentlabs-vs-odoo` | 10 | Comparison-page schema, `BreadcrumbList` |

No fabricated schema fields exist anywhere — confirmed by the existing, still-passing unit test `"organizationJsonLd and websiteJsonLd never include fabricated fields (ratings, reviews, pricing)"` (part of the 36/36 `apps/landing` unit suite, re-run this phase). No `Review`, `AggregateRating`, or `Offer` schema exists anywhere in the codebase — verified via a repo-wide grep for those type strings, zero matches outside this exact prohibition-testing unit test itself.

**Not re-derived from scratch this phase** — Phase 4's `structured-data-map.md` did the deep, page-type-by-page-type design work; this phase's job was to confirm nothing regressed, which it didn't (same block counts, same absence of fabricated fields, confirmed against the live final build rather than assumed carried-forward).

## Open Graph / social metadata

`/opengraph-image` returns a real `200` with `Content-Type: image/png` — a genuinely generated image (via Next.js's built-in `next/og` `ImageResponse`, confirmed in `app/opengraph-image.tsx`), not a broken or missing asset. Uses the same real `COLOR_TOKENS.mutedInk` design token as the rest of the site (Phase 7 fixed this to import the token rather than hardcode a fourth independent copy of the color — see `phase-7/decision-log.md`). No customer logos, fake stats, or fabricated claims appear in the generated image (confirmed via source read — it renders `SITE_IDENTITY.name`, `POSITIONING.heroHeadline`, and 3 real capability facts: "12 connected modules", "1,039 implemented capabilities", "Role-based access").

**No runtime dependency that could fail unpredictably**: the OG image generator uses no external font fetch, no filesystem path outside the Next.js build output, and no screenshot capture — it's pure JSX-to-image rendering with inline styles, confirmed by reading the full source. This directly satisfies the workstream's requirement that OG generation "cannot fail because of an unsupported font, filesystem path, environment assumption, or inaccessible screenshot."

## Icons and manifest

- `/manifest.webmanifest` → real `200`.
- `/icon.svg` → real `200`.
- No fake PWA functionality is claimed anywhere — the manifest exists for browser tab/bookmark icon presentation, not offline support, and nothing in the codebase implies otherwise (no service worker, no `manifest.json`'s `display: "standalone"` combined with any offline-capability claim).

## Security headers

Confirmed via direct `curl -D -` against the live production build's real HTTP response (not inferred from `next.config.mjs` alone):

```
Content-Security-Policy: default-src 'self'; base-uri 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-Permitted-Cross-Domain-Policies: none
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

All present, unchanged from Phase 2/7 (no Phase 8 change touched `next.config.mjs`). `Strict-Transport-Security` correctly appears only in the production build (conditional on `NODE_ENV === "production"` in `next.config.mjs`, confirmed present here because this is a real production build) — it correctly does not appear in local dev, avoiding the workstream's named risk of HSTS harming local development. HSTS assumes HTTPS termination happens in front of this server (at the load balancer/CDN/reverse proxy layer) — this is a standard, correct assumption for a header set by the application itself, not something this application can verify at the app layer; flagged in `deployment-rehearsal.md` as something the actual hosting configuration must provide.

## CSP — final cross-browser verification

Phase 2 previously had a real CSP regression (blocking Next.js's own inline hydration scripts). This phase re-verified **CSP regression-freeness** across **all 5 tested browser engine/device combinations** (`desktop-chromium`, `mobile-chromium`, `desktop-firefox`, `desktop-webkit`, `mobile-webkit`) via `tests/e2e/cross-browser-smoke.spec.ts`'s console-error sweep across 11 representative routes — **80/80 tests passed, zero console errors on any route in any engine**, meaning the CSP is not blocking anything this application legitimately needs, in any tested engine. This is the first time this CSP has been verified outside Chromium. No CSP directive was loosened this phase (`next.config.mjs` was not touched).

**What this does NOT mean, stated precisely (a Cycle 2 security review correctly flagged the original wording here as overstated):** `script-src 'self' 'unsafe-inline'` (no nonce) means this CSP does not, and structurally cannot, prevent an attacker-injected inline script from executing — `'unsafe-inline'` explicitly permits inline script execution regardless of origin. An injected inline script would run silently, producing no console error and no CSP violation, because inline execution is exactly what this directive allows. The 80/80 result proves **no regression** in Next.js's own required inline-script functionality across 5 engines — it is not evidence this CSP blocks XSS. This is a known, disclosed, pre-existing trade-off (the same pattern `apps/web` already uses, per Phase 2's own decision log explaining why: a stricter nonce-based CSP requires per-request nonce-minting middleware, judged disproportionate scope for this phase), not something Phase 8 introduced or is claiming to have resolved.

## CORS / origin

`connect-src 'self'` in the CSP above means the browser itself blocks any client-side request to a non-same-origin destination — the strongest practical form of "no unapproved remote origin" enforcement, verified by the same zero-console-error result (a blocked cross-origin `fetch` would surface as a console error, and none occurred). Server-to-server CORS (the CRM capture proxy) is covered in `security-header-audit.md`'s counterpart discussion — see also `phase-7/analytics-integrity-audit.md` for the client-side analytics sink's same-origin-only design.
