# Phase 2 — Implementation Summary

Vercentlabs Landing Redesign — Prompt 2 of 8: Production Scaffold, Design System, Global Navigation and Reusable Marketing Framework.

## What shipped

- **`apps/landing`** recreated from scratch as `@vercentlabs/landing` — Next.js `16.2.11` / React `19.2.3` / TypeScript `^5.9.3`, matching `apps/web` exactly to avoid monorepo peer-dependency drift.
- **Production boot path repaired.** `output: "standalone"` configured; verified end-to-end by building, running `scripts/prepare-standalone.mjs` (copies `.next/static` and `public/` into the standalone bundle, mirroring `infrastructure/docker/Dockerfile.landing`'s copy steps), and booting the actual repo-root `server.js` — confirmed `GET /` returns `200` through the real production entry point, not just `next dev`.
- **Design system** implementing the "Control Surface" creative direction: semantic color/radius/shadow/spacing/typography/motion tokens (extending `packages/landing-content/src/tokens.js`), wired into Tailwind v4 via `app/globals.css`'s `@theme` block.
- **Global navigation**: sticky header, two mega-menu patterns (a simple "Product" dropdown and a full 5-group "Modules" mega menu), a portalled mobile navigation dialog with a two-level accordion, footer, and breadcrumbs.
- **Reusable component library**: layout primitives, typography, buttons/links, cards/panels/tags, form primitives, and a product-screenshot framework with an honest no-screenshots-yet state.
- **`/design-system`** — a noindex, unlinked (from public nav) review route rendering every component and state.
- **A temporary, honest homepage** at `/` — proves the shell works; explicitly states the full homepage is Phase 3 work.
- **SEO/metadata foundation**: `robots.ts`, `sitemap.ts` (one real route today), `manifest.ts`, a shared `buildPageMetadata` helper, `Organization`/`WebSite`/`BreadcrumbList` JSON-LD helpers with a script-injection-safety helper.
- **Tests**: 17 `node --test` unit/content-integrity tests, 12 `landing-content` package tests (including new token-integrity tests), and a 30-test Playwright suite (functional + visual-capture) run twice — once against `next start`-equivalent production build via the real `server.js`, at both desktop and mobile viewports.

## Real defects found and fixed during this phase

Four genuine bugs were found by actually building, running, and testing the app (not just reading source) — each is documented in detail in `decision-log.md`. Summary:

1. **CSP blocked Next.js's own inline hydration scripts in production** — `script-src 'self'` with no `'unsafe-inline'` broke every page load under a real production boot. Fixed to match `apps/web`'s proven-working CSP.
2. **Next.js `<Link>` prefetching 404'd against not-yet-built routes** — every footer/nav link pointing at a Phase 4/5 page (correctly, per this phase's scope) triggered background RSC prefetch requests that 404'd and surfaced as console errors. Fixed by disabling prefetch on links to routes that don't exist yet.
3. **Mobile navigation dialog collapsed to 64px tall** — the header's `backdrop-saturate` (a `backdrop-filter`) created a new CSS containing block for the mobile nav's `fixed inset-0` dialog, making it positioned relative to the 64px header instead of the viewport. Fixed by removing the backdrop-filter (also a Control Surface compliance fix — no glass/blur effects) and portalling the dialog to `document.body` for defense in depth.
4. **Every CSS-variable-based Tailwind utility was silently a no-op** — `bg-[--color-bg-elevated]` (square brackets) compiled to invalid CSS (`background-color: --color-bg-elevated`, missing `var()`); Tailwind v4 requires parentheses (`bg-(--color-bg-elevated)`) for this shorthand. This affected 231 occurrences across 17 files (essentially every color/radius/shadow token usage in the app) and caused the mega menu to render with no visible background, letting page content show through it. Fixed with a scripted global replacement, then verified against the compiled CSS output directly.

All four were caught by the validation loop this phase's brief mandated (real production build → real production boot → real browser automation → actual screenshot inspection), not by reading code. See `docs/landing-redesign/phase-2/responsive-validation.md` and `accessibility-validation.md` for the passing re-runs after each fix.

## What was deliberately NOT built

Per the brief's explicit scope boundaries:
- No final 12-section homepage (Phase 3).
- No module, industry, workflow, or SEO content pages (Phases 4-6).
- No real product screenshots (none exist yet — the product-screenshot framework's honest empty state is the correct behavior until real, approved screenshots are supplied).
- No analytics instrumentation beyond the fixed event-name contract already defined in `docs/landing-redesign/phase-1/conversion-architecture.md`.
- No lead-capture form submission logic — form *components* exist and are shown in every state on `/design-system`, but no page wires them to the real `apps/web` capture endpoint yet (that's Phase 3).
