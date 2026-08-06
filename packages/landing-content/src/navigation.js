/**
 * Mega-menu and CTA structure from docs/landing-redesign/phase-1/information-architecture.md
 * and conversion-architecture.md. `navGroup` values here must match the `navGroup` field
 * assigned to each module in modules.js.
 */
export const MODULE_NAV_GROUPS = Object.freeze([
  { key: "revenue", label: "Revenue", moduleKeys: ["crm", "sales", "point-of-sale"] },
  { key: "operations", label: "Operations", moduleKeys: ["procurement", "stock", "manufacturing", "quality"] },
  { key: "finance", label: "Finance", moduleKeys: ["accounting", "assets"] },
  { key: "people-and-service", label: "People & Service", moduleKeys: ["hr-payroll", "support"] },
  { key: "delivery", label: "Delivery", moduleKeys: ["projects"] },
]);

export const PRIMARY_NAV = Object.freeze([
  {
    label: "Product",
    href: "/product",
    children: [
      { label: "Platform", href: "/product/platform" },
      { label: "Automation", href: "/product/automation" },
      { label: "Analytics", href: "/product/analytics" },
      { label: "Mobile", href: "/product/mobile" },
      { label: "Security", href: "/security" },
      { label: "Integrations", href: "/product/integrations" },
    ],
  },
  { label: "Modules", href: "/modules" },
  { label: "Industries", href: "/industries" },
  { label: "Pricing", href: "/pricing" },
  { label: "Resources", href: "/resources" },
]);

/**
 * CTA labels and wording rules from conversion-architecture.md: never generic
 * ("Learn More"/"Get Started") — always name the action and, where relevant, the object.
 */
export const CTAS = Object.freeze({
  primary: { label: "Book a Product Demo", href: "/book-demo" },
  exploreProduct: { label: "Explore the Platform", href: "/product/platform" },
  exploreModules: { label: "Explore Modules", href: "/modules" },
  watchTour: { label: "Watch Product Tour", href: "/product-tour" },
  seeHowItWorks: { label: "See How It Works", href: "/workflows" },
  talkToSpecialist: { label: "Talk to an ERP Specialist", href: "/book-demo?intent=specialist" },
});

/**
 * Analytics event names not tied to a specific homepage section (those are
 * declared per-section via `analyticsId` in homepage.js instead — see
 * apps/landing/lib/analytics.ts's HomepageAnalyticsId type). Reconciled in
 * Phase 3 against what apps/landing actually calls track() with; three
 * entries (module_page_view, industry_page_view, product_tour_play) are
 * reserved for Phase 4-5 pages that don't exist yet.
 */
export const ANALYTICS_EVENTS = Object.freeze([
  "homepage_view",
  "demo_form_start",
  "demo_form_validation_error",
  "demo_form_submit",
  "demo_form_success",
  "demo_form_error",
  "product_demo_complete",
  "product_tour_play",
  "module_page_view",
  "industry_page_view",
]);
