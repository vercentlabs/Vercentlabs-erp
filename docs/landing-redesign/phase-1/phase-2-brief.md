> Vercentlabs Landing Redesign — Phase 1 deliverable for Prompt 2
> Prompt 2 scope per the eight-stage roadmap: design system, typography system, colour system, marketing layout primitives, button/link system, cards, navigation, mega menu, mobile navigation, footer, product screenshot framework, motion foundation, shared responsive sections, accessibility primitives.

## Zero-th acceptance criterion: restore the production boot path

Before any design-system work, Prompt 2 must scaffold `apps/landing` as a real, buildable Next.js app — because `server.js` (repo root) directly requires `apps/landing/.next/standalone/apps/landing/server.js` and production deployment is currently non-functional without it (see [[current-experience-audit]]). Concretely:
- Package name `@vercentlabs/landing` at `apps/landing`, matching every existing reference in root `package.json`, `server.js`, `infrastructure/docker/Dockerfile.landing`, `infrastructure/docker/compose.production.example.yml`.
- Next.js `16.2.11`, React `19.2.3`, TypeScript `^5.9.3`, ESLint `^9` + `eslint-config-next@16.2.11` (gets `eslint-plugin-jsx-a11y` for free), Prettier `^3.7.4` — matching `apps/web`'s versions to avoid monorepo peer-dependency drift.
- `next.config.mjs` with `output: "standalone"` (required by the Docker/production boot path) and a CSP/security-headers block adapted from `apps/web/next.config.mjs`.
- `test` script following the one convention that actually works in this repo today: `node --test` over a co-located `tests/*.test.mjs` directory (per `packages/config/tests/config.test.mjs`) — do not assume `tests/e2e`/`tests/integration`/`tests/security` at repo root exist to plug into; they were removed in a prior commit (`ed91276`) and are absent from disk.
- A styling-stack decision made explicitly (not defaulted silently): the deleted landing app used Tailwind + shadcn/ui; `apps/web` uses hand-rolled CSS custom properties. `packages/shared-ui` is not a real component library (3 unstyled primitives) and doesn't force either choice. Tailwind v4 (CSS-first `@theme`, already present at the workspace root's lockfile) is the recommended default for velocity across ~40 planned pages, but this is Prompt 2's decision to make and record, not this phase's.

## Design tokens — must implement Direction A's spec exactly

Per [[creative-direction]]'s "Direction A — implementation-ready specification":
- **Colour:** off-white/near-white canvas, ink-dark text (`#101828`-class). One flat, non-gradient accent — indigo (`#4338ca`/`#4f46e5` family, taken from the real brand-mark's darker gradient stop in `apps/web/src/app/globals.css:215-231`). Cyan (`#0891b2`) as a rare second signal only. Per-module accent tokens: **only 4 of 12 modules have a real, dedicated accent token in the product today** — `apps/web/src/app/enterprise-modules.css:1-58` is explicitly headed "Final visual and interaction layer for CRM, Sales, Procurement and Accounting," and defines `--module-crm` (`#6956d9`), `--module-sales` (`#2468d7`), `--module-procurement` (`#087f6a`), `--module-accounting` (`#31566f`). The other 8 modules (Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, Support, HR & Payroll) fall back to the generic `--module-accent: var(--color-primary)` (indigo) in the product — they do not yet have distinct product colors to "reuse verbatim." `packages/landing-content/src/modules.js` (this phase's foundation) reuses the real 4 verbatim and defines 8 additional, landing-only accent colors in the same palette family, explicitly commented as landing-original rather than product-sourced, so this distinction is never lost. Never blend any of these into gradients.
- **Typography:** one neutral system/grotesque family, tabular numerals for all data, headline tracking -0.04 to -0.05em, body line-height 1.6-1.7. No new webfont dependency is required (the product has never shipped one) — evaluate a single variable sans only if it's a genuine improvement over system-ui, and don't let font selection block the rest of Prompt 2.
- **Shape:** rectangles, 8-16px radius (the product's tighter `operator-workbench.css` scale, not its softer 20-28px marketing scale). No pill-shaped elements as a default pattern — this is a deliberate correction of the product's own pill overuse (flagged by the Brand & Design Director's audit).
- **Borders/elevation:** 1px hairline borders doing real structural work; shadows limited to the product's own subtle/panel tiers; **no blur, no glass** (the product's own topbar glassmorphism is explicitly not carried over).
- **Grid:** visible column grid with thin hairline verticals; max content width in the 1520-1680px range (matching the product's own `--content-max` values).
- **Motion:** count-up numbers once on scroll-into-view, sequential callout reveals, 1-2px hover lift; must respect `prefers-reduced-motion` (the product's CSS already does this at `globals.css:3546-3555` — mirror the same technique).

## Component acceptance criteria

- **Buttons/links:** primary (solid indigo), secondary (outline/text), and a distinct "specialist" variant for the "Talk to an ERP Specialist" CTA framing per [[conversion-architecture]]. No generic "Learn More"/"Get Started" labels anywhere in the component API defaults — labels must be explicit props, not baked-in placeholder text that invites lazy copy later.
- **Cards:** used sparingly per the creative direction (Direction A explicitly avoids "excessive card grids") — a module-index/table-of-contents component is not a card grid; build it as a distinct primitive, not a relabeled card component.
- **Navigation:** implement the mega-menu groups exactly as specified in [[information-architecture]] — Product, Modules (grouped: Revenue/Operations/Finance/People & Service/Delivery), Industries, Pricing, Resources, plus a persistent Book a Demo button. Do not expose a flat 12-item module list.
- **Mobile navigation:** accordion collapsing to the same groups; Book a Demo becomes a bottom-anchored persistent button, never hidden behind the hamburger menu (per [[conversion-architecture]]'s mobile CTA rule).
- **Footer:** module list, company/about/legal links, secondary (non-primary-styled) Book a Demo link, `Organization` structured-data hook point.
- **Product screenshot framework:** thin plain-chrome frame (no OS window furniture, no 3D tilt), numbered-callout annotation system, one-line caption slot, `next/image` with explicit dimensions and required non-decorative `alt` text — this is the single most-reused primitive across the whole 40+ page IA and should be built first among the components.
- **Shared responsive sections:** hero (headline + subhead + large annotated screenshot, no separate "product visual" slot per [[homepage-blueprint]]'s merge decision), module-index section, workflow-pipeline-diagram section, CTA-block section (reused for mid-page and footer-adjacent placements).
- **Accessibility primitives:** the module-color-coding system must ship with WCAG-AA-compliant text/background pairings for every module accent (verify each of the 12 tokens against both the off-white canvas and any on-dark usage); numbered callouts need a text-alternative pattern, not color/number-only meaning.

## SEO/metadata foundation to scaffold (structure only, content in later phases)

Per [[seo-aeo-geo-architecture]]: a shared `generateMetadata` helper (title pattern, description, canonical), `sitemap.ts` sourcing `lastModified` from content data, `robots.ts`, an OG-image route, and `Organization`/`WebSite`/`BreadcrumbList` structured-data helpers. None of this survives from the deleted app (confirmed zero sitemap/robots/JSON-LD/analytics code exists anywhere in the current repo) — build fresh, informed only by the old app's file-path shape (`opengraph-image.tsx`, `manifest.ts`) as a naming checklist, not surviving implementation.

## Lead-capture foundation to scaffold (structure only, full flow in Prompt 3)

Per [[conversion-architecture]] and the Frontend Architecture agent's findings: a real, working precedent already exists server-side at `apps/web/src/app/api/crm/public/capture/[key]/route.ts` — a per-organization public lead-capture endpoint accepting either direct submissions or **HMAC-signed proxy delivery** (headers `x-vercentlabs-capture-timestamp`, `x-vercentlabs-capture-fingerprint`, `x-vercentlabs-capture-signature`, verified via `CRM_CAPTURE_PROXY_SECRET`, 5-minute replay window, `timingSafeEqual` comparison) plus two zero-length honeypot fields (`websiteUrl`, `companyWebsiteHidden`). Prompt 2/3 should build the landing-side proxy that signs and forwards to this existing endpoint — not a parallel lead-storage mechanism. This is a concrete, already-implemented contract to build against, not a guess.

## Explicit non-goals for Prompt 2

- No homepage copy or final section content (Prompt 3).
- No module/industry/workflow page content (Prompts 4-5).
- No SEO/AEO content production, only the structural helpers (Prompt 6 owns content).
- No analytics event wiring beyond defining the event name list already fixed in [[conversion-architecture]] (Prompt 7 owns instrumentation depth/QA).
