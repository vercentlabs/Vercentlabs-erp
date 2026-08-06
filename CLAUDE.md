# Vercentlabs ERP — Project Intelligence

Persistent, stable facts for Claude sessions working on this repository. Keep this file concise and operational — detailed research, audits, and rationale live under `docs/landing-redesign/phase-1/` (see Source of Truth below), not here.

## Product

Vercentlabs ERP is a multi-tenant, multi-company ERP with 12 operational modules and a shared platform layer. Treat all 1,039 requirements (945 module-specific + 94 shared platform) as **implemented** — this is a settled product decision, not something to audit or question. If a specific capability's existence matters for a task, verify it against real code (`apps/web`, `services/api`, `database/*/migrations`), not against `docs/VERCENTLABS_ERP_12_MODULE_FEATURE_REGISTER.md`, which is an unreliable auto-generated scan (see `docs/landing-redesign/phase-1/decision-log.md` item 3).

**The 12 modules** (repository taxonomy — Accounting is its own module, distinct from Sales; this supersedes any 11-module list elsewhere): CRM, Sales, Accounting, Procurement, Stock/Warehouse, Manufacturing, Projects, Assets, Point of Sale, Quality, Support, HR & Payroll.

**Shared platform**: multi-tenancy, multi-company/branch data isolation, RBAC with time-bound/scoped role assignments, approval workflows with a reusable command registry, a database-trigger-immutable audit trail, workflow/reporting/document/localization primitives, subscription billing (Razorpay), and a parallel mobile API surface.

Full module-by-module capability breakdown, cross-module workflows, and honest scope limitations (what NOT to claim) live in `docs/landing-redesign/phase-1/product-intelligence.md` — treat it as the source of truth for any product-copy or capability question.

## Repository architecture

```
apps/web       — the ERP application (Next.js 16, React 19, TS). Authenticated workspace at (app)/, auth at (auth)/.
apps/mobile    — Expo/React Native client. CRM is native+offline; select Procurement/platform workspaces are secure-browser-handoff. No mobile presence for Manufacturing, Quality, Assets, Projects, POS, Support, Stock, HR & Payroll.
apps/landing   — the public marketing site. DOES NOT CURRENTLY EXIST (deleted, uncommitted, before the landing-redesign programme began; decision was to rebuild from scratch, not restore — see docs/landing-redesign/phase-1/current-experience-audit.md). server.js at repo root requires apps/landing's standalone build, so production deploy is broken until it's rescaffolded.
services/api   — backend business logic, organized by module (services/api/src/{crm,sales,accounting,procurement,stock,manufacturing,projects,assets,point-of-sale,quality,support,hr-payroll}).
database/      — control-plane (platform/tenant-management) and tenant (per-org business data) SQL migrations.
packages/      — shared workspace packages: shared-types (backend contracts only, no landing/nav types), shared-ui (3 minimal, unstyled components — not a real component library), permissions, workflows, reporting-engine, document-engine, localization, config (env-var validation, not a lint/tsconfig/tailwind preset).
```

No shared eslint/tsconfig/Tailwind preset package exists — every app owns its own config from scratch. `apps/web` uses hand-rolled CSS custom properties, not Tailwind; the deleted `apps/landing` used Tailwind + shadcn/ui — this is a real, unresolved styling-stack fork, not an oversight.

## Build/test commands

Package manager: pnpm `11.17.0` via corepack. Per-app scripts follow `{action}:{app}` (e.g. `dev:web`, `build:web`, `lint:web`, `typecheck:web`, `test:web`). `apps/web`'s own testing convention (`node --test` over co-located `tests/*.test.mjs`) is the one that actually works today — root-level `tests/e2e`/`tests/integration`/`tests/security` were removed in commit `ed91276` and `apps/web/scripts/verify-*.mjs` files referenced by its own `package.json` are absent from disk. Do not assume either exists without checking first.

## Design principles

Selected creative direction: **"Control Surface"** — structured, blueprint-grade, real annotated product screenshots as primary content, flat single-accent indigo (no gradients), tight radii (8-16px), near-flat elevation, hairline borders, no glass/blur, disciplined motion (respects `prefers-reduced-motion`). Full rationale and implementation spec: `docs/landing-redesign/phase-1/creative-direction.md`. Real per-module accent colors already exist in the product (`apps/web/src/app/enterprise-modules.css`) and should be reused verbatim, not reinvented.

Avoid: generic blue-purple gradients, glassmorphism, fake dashboard illustrations, stock photography, excessive card grids or pill shapes, huge empty hero space, copying any named competitor's visual identity wholesale.

## Content principles

Confident, evidence-grounded copy — state what's implemented plainly, never hedge or apologize for scope. **Never fabricate**: customer names/logos/testimonials, user counts, revenue, market share, review scores, awards, certifications, uptime stats, performance improvements, ROI percentages, migration times, support-response guarantees, or search-volume/ranking data. When customer evidence doesn't exist yet, substitute real product screenshots, real workflows, and transparent methodology/security content instead. Full rules: see the governing brief's "Evidence and Honesty Rules" (reproduced in `docs/landing-redesign/phase-1/positioning-and-messaging.md` and `product-intelligence.md`'s "Honest Limitations" section — the latter lists specific things the code does NOT yet do; do not claim them).

## SEO/AEO/GEO principles

One page owns one query family (no cannibalisation). Every module/workflow/industry page must stand alone as a complete answer (direct-answer opening paragraph, real FAQs, consistent entity names). No keyword stuffing, hidden content, mass-generated thin pages, fabricated comparisons/stats/reviews, or location-page farming. Full architecture: `docs/landing-redesign/phase-1/seo-aeo-geo-architecture.md`.

## Conversion objective

Primary CTA everywhere: **Book a Product Demo**. Secondary: Explore the Platform, Explore Modules, Watch Product Tour, See How It Works, Talk to an ERP Specialist. Full conversion architecture and lead-capture contract (a real, working endpoint already exists at `apps/web/src/app/api/crm/public/capture/[key]/route.ts` — HMAC-signed proxy delivery, honeypot fields — build the landing side against it, don't invent a parallel mechanism): `docs/landing-redesign/phase-1/conversion-architecture.md`.

## Accessibility target

WCAG AA minimum. `eslint-config-next` (used by `apps/web`, should be used by the rebuilt `apps/landing`) includes `eslint-plugin-jsx-a11y` automatically. Verify every module accent color against WCAG AA text/background contrast before using it as a text color, not just a swatch.

## Git safety rules

Never use destructive git commands (`reset --hard`, `clean -fd`, forced checkout/push, broad deletion) without explicit user confirmation for that specific action. Always run `git status` before anything that could discard uncommitted work. If repository state looks unexpected (files missing that should exist, unfamiliar staged changes), investigate and ask before proceeding — do not assume and do not silently "fix" it. `apps/landing` being absent is expected (see above), not a bug to silently repair by restoring old files.

## Eight-stage landing redesign roadmap

1. Product intelligence and creative direction — **complete**, see `docs/landing-redesign/phase-1/`.
2. Design system, global shell, reusable marketing components — see `docs/landing-redesign/phase-1/phase-2-brief.md` for exact scope/acceptance criteria.
3. Homepage implementation and conversion experience.
4. Module and platform pages.
5. Industry, solution, workflow, and implementation pages.
6. SEO, AEO, GEO, and content-authority system.
7. CRO, analytics, performance, and accessibility optimisation.
8. Complete application alignment, QA, and launch preparation.

## Source of truth documents

All strategic decisions for the landing redesign live under `docs/landing-redesign/phase-1/`: `current-experience-audit.md`, `product-intelligence.md`, `category-and-competitor-research.md`, `icp-and-buyer-map.md`, `positioning-and-messaging.md`, `conversion-architecture.md`, `information-architecture.md`, `seo-aeo-geo-architecture.md`, `search-intent-map.md`, `creative-direction.md`, `homepage-blueprint.md`, `decision-log.md`, `phase-2-brief.md`. Reusable specialist subagents for later phases live in `.claude/agents/`. Typed product-content foundations (modules, workflows, ICPs, nav, CTAs) live in `packages/shared-types/src/landing-content.ts` (or wherever Prompt 2 scaffolds `apps/landing`'s content layer — check both locations if uncertain).
