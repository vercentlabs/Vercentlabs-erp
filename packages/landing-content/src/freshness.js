/**
 * Content freshness registry — a real, deterministic model replacing the
 * single `HOMEPAGE_METADATA.lastReviewed` date `sitemap.ts` previously
 * applied to every route uniformly (a Phase 4-flagged, Phase 5-reflagged,
 * now-fixed gap).
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
// /compare and /compare/vercentlabs-vs-odoo were edited on 2026-10-02 (the
// false "Vercentlabs pricing is quote-based" statement and time-sensitive
// competitor price ranges were removed), but their competitor facts have NOT
// been re-researched. Their dates are deliberately left unchanged so
// content:stale keeps flagging them as overdue for review; bump them only
// after a real competitor review.
export const CONTENT_FRESHNESS = Object.freeze({
  "/": {
    publishedAt: "2026-08-05",
    lastModifiedAt: "2026-10-02",
    lastReviewedAt: "2026-10-02",
    reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected.",
  },
  "/book-demo": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-08-07",
    lastReviewedAt: "2026-08-07",
    reviewReason: "Extended conversion-context handling to ?industry=/?workflow=/?solution= alongside the original ?module=.",
  },
  "/product": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-10-02",
    lastReviewedAt: "2026-10-02",
    reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected.",
  },
  "/modules": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-10-02",
    lastReviewedAt: "2026-10-02",
    reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected.",
  },
  "/modules/crm": { publishedAt: "2026-08-06", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/modules/sales": { publishedAt: "2026-08-06", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/modules/accounting": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-10-02",
    lastReviewedAt: "2026-10-02",
    reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected.",
  },
  "/modules/procurement": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-10-02",
    lastReviewedAt: "2026-10-02",
    reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected.",
  },
  "/modules/stock": { publishedAt: "2026-08-06", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/modules/manufacturing": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-10-02",
    lastReviewedAt: "2026-10-02",
    reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected.",
  },
  "/modules/projects": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-10-02",
    lastReviewedAt: "2026-10-02",
    reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected.",
  },
  "/modules/assets": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-10-02",
    lastReviewedAt: "2026-10-02",
    reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected.",
  },
  "/modules/point-of-sale": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-10-02",
    lastReviewedAt: "2026-10-02",
    reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected.",
  },
  "/modules/quality": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-10-02",
    lastReviewedAt: "2026-10-02",
    reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected.",
  },
  "/modules/support": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-10-02",
    lastReviewedAt: "2026-10-02",
    reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected.",
  },
  "/modules/hr-payroll": {
    publishedAt: "2026-08-06",
    lastModifiedAt: "2026-10-02",
    lastReviewedAt: "2026-10-02",
    reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected.",
  },
  "/product/platform": { publishedAt: "2026-08-06", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/product/automation": { publishedAt: "2026-08-06", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/product/analytics": { publishedAt: "2026-08-06", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/product/mobile": { publishedAt: "2026-08-06", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/product/integrations": { publishedAt: "2026-08-06", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/security": { publishedAt: "2026-08-06", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/privacy": { publishedAt: "2026-08-08", lastModifiedAt: "2026-08-08", lastReviewedAt: "2026-08-08", reviewReason: "Published at Phase 8 launch hardening." },
  "/terms": { publishedAt: "2026-08-08", lastModifiedAt: "2026-08-08", lastReviewedAt: "2026-08-08", reviewReason: "Published at Phase 8 launch hardening." },
  "/industries": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/industries/manufacturing": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/industries/distribution": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/industries/retail": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/industries/professional-services": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/solutions": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/solutions/replace-spreadsheets": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/solutions/connect-business-operations": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/solutions/multi-company-management": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/solutions/workflow-automation": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/solutions/real-time-business-reporting": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/workflows": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/workflows/lead-to-cash": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/workflows/procure-to-pay": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/workflows/order-to-fulfilment": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/workflows/plan-to-production": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/workflows/project-to-profitability": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/workflows/hire-to-payroll": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/implementation": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/resources/glossary": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/resources/glossary/erp": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/resources/glossary/crm": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/resources/glossary/mrp": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/resources/glossary/bom": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/resources/glossary/reorder-point-and-safety-stock": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/resources/glossary/three-way-match": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/resources/glossary/purchase-requisition": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/resources/glossary/rbac": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/resources/glossary/maker-checker": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/resources/glossary/multi-tenant-saas": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/resources/glossary/multi-company-erp": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/resources": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/resources/erp-buying-guide": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/resources/erp-requirements-checklist": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/resources/erp-implementation-checklist": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Phase 6 launch: new cornerstone guide." },
  "/resources/erp-migration-guide": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Phase 6 launch: new cornerstone guide." },
  "/resources/manufacturing-erp-guide": { publishedAt: "2026-08-07", lastModifiedAt: "2026-10-02", lastReviewedAt: "2026-10-02", reviewReason: "Product-truth pass: product claims checked against the approved launch capability register; claims outside the approved MVP scope removed or corrected." },
  "/resources/erp-vs-spreadsheets": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Phase 6 launch: new cornerstone guide." },
  "/compare": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-07", lastReviewedAt: "2026-08-07", reviewReason: "Phase 6 launch: new comparison index." },
  "/compare/vercentlabs-vs-odoo": { publishedAt: "2026-08-07", lastModifiedAt: "2026-08-08", lastReviewedAt: "2026-08-08", reviewReason: "Phase 8 pre-launch re-verification: Odoo's Standard/Custom plan pricing re-fetched from odoo.com, corrected from ₹580–950/₹890–1,420 to ₹580–760/₹890–1,140 to match current listed pricing." },
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
