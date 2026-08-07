/**
 * Content freshness registry — a real, deterministic model replacing the
 * single `HOMEPAGE_METADATA.lastReviewed` date `sitemap.ts` previously
 * applied to every route uniformly (a Phase 4-flagged, Phase 5-reflagged,
 * now-fixed gap — see docs/landing-redesign/phase-6/decision-log.md).
 *
 * Every date below is grounded in this repository's real git history
 * (`git log --format=%ad -- <file>`), not invented. `publishedAt` is the
 * route's first real commit; `lastModifiedAt` is the most recent commit
 * that changed main content, structured data, an important internal link,
 * a product fact, a citation, a page-specific screenshot, or a material
 * recommendation — never a build timestamp, a copyright-year bump, or a
 * formatting-only change. `reviewReason` states in plain language what the
 * last significant change actually was, so the date carries real meaning
 * even where several routes share a date (this project's actual build
 * history spans 2026-08-05 through the current date, not weeks — dates
 * cluster because that's genuinely when the work happened, not because
 * they were invented to look varied).
 *
 * Keyed by the route's real pathname. `getFreshness()` throws on an unknown
 * path rather than silently falling back — every indexable route must have
 * a real, explicit entry here (enforced by
 * packages/landing-content/tests/freshness.test.mjs).
 */
export const CONTENT_FRESHNESS = Object.freeze({
  "/": {
    publishedAt: "2026-08-05",
    lastModifiedAt: "2026-08-07",
    lastReviewedAt: "2026-08-07",
    reviewReason: "Phase 5 footer restructure (Industries column, Solutions/Workflows links) and Phase 6 mobile sticky-CTA breakpoint fix.",
  },
  "/book-demo": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-08-07",
    lastReviewedAt: "2026-08-07",
    reviewReason: "Extended conversion-context handling to ?industry=/?workflow=/?solution= alongside the original ?module=.",
  },
  "/product": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-08-06",
    lastReviewedAt: "2026-08-07",
    reviewReason: "Phase 4 Cycle 3 regression pass; no content change since.",
  },
  "/modules": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-08-06",
    lastReviewedAt: "2026-08-07",
    reviewReason: "Phase 4 Cycle 3 regression pass; no content change since.",
  },
  "/modules/crm": { publishedAt: "2026-08-06", lastModifiedAt: "2026-08-06", lastReviewedAt: "2026-08-07", reviewReason: "Phase 4 content, unchanged since." },
  "/modules/sales": { publishedAt: "2026-08-06", lastModifiedAt: "2026-08-06", lastReviewedAt: "2026-08-07", reviewReason: "Phase 4 content, unchanged since." },
  "/modules/accounting": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-08-07",
    lastReviewedAt: "2026-08-07",
    reviewReason: "Fixed a mismatched screenshot (Accounting was showing a Sales screen) and added a real dedicated dashboard screenshot.",
  },
  "/modules/procurement": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-08-07",
    lastReviewedAt: "2026-08-07",
    reviewReason: "Added a dedicated purchase-orders-list screenshot, closing a Phase 4-documented evidence gap.",
  },
  "/modules/stock": { publishedAt: "2026-08-06", lastModifiedAt: "2026-08-06", lastReviewedAt: "2026-08-07", reviewReason: "Phase 4 content, unchanged since." },
  "/modules/manufacturing": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-08-07",
    lastReviewedAt: "2026-08-07",
    reviewReason: "Added a dedicated production-control dashboard screenshot, closing a Phase 4-documented evidence gap.",
  },
  "/modules/projects": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-08-07",
    lastReviewedAt: "2026-08-07",
    reviewReason: "Added a dedicated delivery/profitability dashboard screenshot.",
  },
  "/modules/assets": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-08-07",
    lastReviewedAt: "2026-08-07",
    reviewReason: "Added a dedicated lifecycle/maintenance dashboard screenshot.",
  },
  "/modules/point-of-sale": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-08-07",
    lastReviewedAt: "2026-08-07",
    reviewReason: "Added a dedicated checkout/shift-control dashboard screenshot.",
  },
  "/modules/quality": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-08-07",
    lastReviewedAt: "2026-08-07",
    reviewReason: "Added a dedicated inspection dashboard screenshot (real, though evidence remains lighter than other modules — see product-evidence-update.md).",
  },
  "/modules/support": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-08-07",
    lastReviewedAt: "2026-08-07",
    reviewReason: "Added a dedicated customer-service dashboard screenshot.",
  },
  "/modules/hr-payroll": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-08-07",
    lastReviewedAt: "2026-08-07",
    reviewReason: "Added a dedicated workforce/payroll dashboard screenshot.",
  },
  "/product/platform": { publishedAt: "2026-08-06", lastModifiedAt: "2026-08-06", lastReviewedAt: "2026-08-07", reviewReason: "Phase 4 content, unchanged since." },
  "/product/automation": { publishedAt: "2026-08-06", lastModifiedAt: "2026-08-06", lastReviewedAt: "2026-08-07", reviewReason: "Phase 4 content, unchanged since." },
  "/product/analytics": { publishedAt: "2026-08-06", lastModifiedAt: "2026-08-06", lastReviewedAt: "2026-08-07", reviewReason: "Phase 4 content, unchanged since." },
  "/product/mobile": { publishedAt: "2026-08-06", lastModifiedAt: "2026-08-06", lastReviewedAt: "2026-08-07", reviewReason: "Phase 4 content, unchanged since." },
  "/product/integrations": { publishedAt: "2026-08-06", lastModifiedAt: "2026-08-06", lastReviewedAt: "2026-08-07", reviewReason: "Phase 4 content, unchanged since." },
  "/security": { publishedAt: "2026-08-06", lastModifiedAt: "2026-08-06", lastReviewedAt: "2026-08-07", reviewReason: "Phase 4 content, unchanged since." },
  "/industries": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Published at Phase 5 launch, no content change since." },
  "/industries/manufacturing": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Published at Phase 5 launch, no content change since." },
  "/industries/distribution": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Published at Phase 5 launch, no content change since." },
  "/industries/retail": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Published at Phase 5 launch, no content change since." },
  "/industries/professional-services": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Published at Phase 5 launch, no content change since." },
  "/solutions": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Published at Phase 5 launch, no content change since." },
  "/solutions/replace-spreadsheets": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Phase 6: assigned the sales-quotation-detail screenshot, the honest match for its immutable-audit-trail claim (previously had no screenshot)." },
  "/solutions/connect-business-operations": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Phase 6: assigned the sales-order-detail screenshot, the honest match for its governed CRM-to-invoice handoff claim (previously had no screenshot)." },
  "/solutions/multi-company-management": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Phase 6 evidence review: deliberately kept without a screenshot — no approved screenshot shows company/branch isolation or consolidation, and forcing one would misrepresent it." },
  "/solutions/workflow-automation": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Phase 6: assigned the quality-dashboard screenshot (automatic quality-hold claim), and renamed its display name to 'Automate Governed Workflows' — it shared the exact title 'Workflow Automation' with the /product/automation platform page, a real entity collision caught during entity-architecture review." },
  "/solutions/real-time-business-reporting": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Phase 6: assigned the projects-dashboard screenshot, the honest match for its live-project-margin claim (previously had no screenshot)." },
  "/workflows": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Published at Phase 5 launch, no content change since." },
  "/workflows/lead-to-cash": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Added a distinct directDefinition; reviewed for sequence-step overlap with order-to-fulfilment." },
  "/workflows/procure-to-pay": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Added a distinct directDefinition." },
  "/workflows/order-to-fulfilment": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Phase 6: sequence steps that duplicated lead-to-cash's conversion/credit-check/invoice text verbatim were consolidated into shorter cross-references to that workflow, per decision-log item 5." },
  "/workflows/plan-to-production": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Added a distinct directDefinition." },
  "/workflows/project-to-profitability": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Added a distinct directDefinition; modules array corrected to include procurement." },
  "/workflows/hire-to-payroll": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Added a distinct directDefinition; corrected its evidence screenshot's workflow tag." },
  "/implementation": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Published at Phase 5 launch, no content change since." },
});

export function getFreshness(path) {
  const entry = CONTENT_FRESHNESS[path];
  if (!entry) {
    throw new Error(`No CONTENT_FRESHNESS entry for route "${path}" — every indexable route must have a real, explicit freshness record.`);
  }
  return entry;
}

export function hasFreshness(path) {
  return path in CONTENT_FRESHNESS;
}
