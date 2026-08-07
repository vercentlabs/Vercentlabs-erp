# Platform Page Specification

7 pages total: `/product` (distinct, richer shape) + 6 pages sharing `PlatformPageTemplate` (`apps/landing/components/platform/platform-page-template.tsx`). Content lives in `packages/landing-content/src/platform-pages.js`.

## `/product` — Product Overview

Not a `PlatformPageContent` — a dedicated `ProductOverviewPage` shape with 10 named sections (who it's for, connected architecture, five operational domains, shared data, automation summary, access/governance, reporting summary, multi-company/localisation, mobile/integrations, implementation overview) plus its own FAQ set and a hero built from `PlatformHero` (shared component, but this page composes its own body rather than using `PlatformPageTemplate`). Deliberately does not repeat the homepage's copy verbatim — the homepage sells the high-level idea in ~12 homepage-scale sections; this page explains the platform *architecture* in more depth, each section pointing to the relevant platform page for full detail ("See the automation page for the full picture").

## The 6 shared-template pages

| Page | Real evidence anchor | Connected modules shown |
|---|---|---|
| `/product/platform` | Tenant/company structure, roles, approvals, audit trail — all from Shared Platform profile | crm, sales, accounting, hr-payroll |
| `/product/automation` | Real automated behaviors named per module (CRM lead scoring, Quality auto-hold, Sales approval auto-cancel, Manufacturing policy toggles, self-approval blocking) | crm, sales, procurement, manufacturing, quality |
| `/product/analytics` | Real report registries (CRM 14 types, Accounting 16-report registry, Procurement 12-report registry) + export/document primitives | crm, accounting, procurement |
| `/product/mobile` | Explicit native-vs-secure-browser-handoff-vs-absent breakdown — the one platform page built around what's honestly *not* there yet as much as what is | crm, procurement |
| `/product/integrations` | Real API endpoints already built this session (the CRM public-capture endpoint, HMAC webhook patterns, Razorpay billing pipeline) — separated into native / API-supported / configurable | crm |
| `/security` | Structural tenant isolation, RBAC, immutable audit trigger, maker-checker — explicitly states MFA is schema-ready but not enforced, not implied active | accounting, hr-payroll, assets |

## Shared template structure (`PlatformPageTemplate`)

Breadcrumbs → `PlatformHero` (screenshot-led split layout if the page has a `heroScreenshotId` that resolves to an approved screenshot, otherwise single-column) → `DirectDefinition` → N content sections (each a `SectionHeader` + `LabeledItemGrid` of `{title, description}` items) → "Modules built on this capability" (tag row linking to real module pages, only rendered if `connectedModuleKeys` is non-empty) → FAQ accordion (only if the page has FAQs — `/product/mobile` and `/security` do; the automation/analytics/integrations pages don't, to avoid manufacturing FAQ content for content's sake) → final CTA.

Every page's `primaryCta` is `{ label: "Book a Product Demo", href: "/book-demo" }` — platform pages don't carry module-specific query context (that's the module pages' job); a mistaken `?module=platform` was caught and removed during this phase's content-integrity testing (see `decision-log.md`).

## Analytics

All 6 template pages fire `platform_page_view` on scroll-into-view and `platform_cta_click` on CTA click — hardcoded directly in `PlatformPageTemplate`, not stored per-page in content, since every platform page uses the identical pair of event names (an earlier draft stored them as content-driven `analyticsId` fields typed loosely enough to need an `as never` cast to satisfy the strict `AnalyticsEventName` union — removed in favor of hardcoding the two constants directly, which is both simpler and doesn't weaken the type contract Phase 3 fixed).
