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
      { label: "Implementation", href: "/implementation" },
      { label: "Solutions", href: "/solutions" },
      { label: "Workflows", href: "/workflows" },
    ],
  },
  { label: "Modules", href: "/modules" },
  { label: "Industries", href: "/industries" },
  { label: "Resources", href: "/resources" },
]);

/**
 * CTA labels and wording rules from conversion-architecture.md: never generic
 * ("Learn More"/"Get Started") — always name the action and, where relevant, the object.
 */
export const CTAS = Object.freeze({
  primary: { label: "Book a Demo", href: "/book-demo" },
  exploreProduct: { label: "Explore the Platform", href: "/product/platform" },
  exploreModules: { label: "Explore Modules", href: "/modules" },
  watchTour: { label: "Watch Product Tour", href: "/product-tour" },
  seeHowItWorks: { label: "See How It Works", href: "/workflows" },
  talkToSpecialist: { label: "Talk to an ERP Specialist", href: "/book-demo?intent=specialist" },
});

/**
 * Site-wide top announcement bar (components/layout/announcement-banner.tsx).
 * `id` is a dismissal key stored in localStorage — bump it whenever the message
 * changes so visitors who dismissed an earlier announcement see the new one.
 * No fabricated offer/discount/credit amount here: this project's evidence rules
 * (docs/landing-redesign/phase-1's "never fabricate" rule) apply to promotional
 * claims exactly as they do to product claims — a specific number here would be a
 * real commercial promise, not filler copy.
 */
export const ANNOUNCEMENT_BANNER = Object.freeze({
  id: "launch-2026-08",
  message: "Vercentlabs ERP is live — see it running your workflows.",
  ctaLabel: "Book a Demo",
  href: "/book-demo",
});

/**
 * Analytics event names not tied to a specific homepage section (those are
 * declared per-section via `analyticsId` in homepage.js instead — see
 * apps/landing/lib/analytics.ts's HomepageAnalyticsId type). Reconciled in
 * Phase 3 against what apps/landing actually calls track() with, and again in
 * Phase 4 for the new module/platform events — this array and index.d.ts's
 * ANALYTICS_EVENTS tuple type must be kept in exact sync (a Phase 4 Cycle 2
 * review caught this array drifting behind the .d.ts: the type declared 7
 * event names the runtime array never actually had, which typechecked clean
 * only because nothing at runtime validates track() calls against this array
 * — see docs/landing-redesign/phase-4/decision-log.md). This is no longer
 * just a documented convention: tests/analytics-events-sync.test.mjs parses
 * index.d.ts's literal-union source and fails the build if it and this array
 * ever diverge again. "product_tour_play" remains reserved for a page that
 * doesn't exist yet.
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
  "module_hero_cta_click",
  "module_workflow_view",
  "module_related_link_click",
  "module_mid_cta_click",
  "module_final_cta_click",
  "platform_page_view",
  "platform_cta_click",
  "modules_index_view",
  "industries_index_view",
  "industry_final_cta_click",
  "solutions_index_view",
  "solution_page_view",
  "solution_cta_click",
  "workflows_index_view",
  "workflow_page_view",
  "workflow_cta_click",
  "implementation_page_view",
  "implementation_cta_click",
  "resources_index_view",
  "resource_page_view",
  "resource_cta_click",
  "resource_related_click",
  "requirements_filter",
  "requirements_print",
  "glossary_index_view",
  "glossary_page_view",
  "compare_index_view",
  "comparison_page_view",
  "comparison_cta_click",
  "source_link_click",
  "web_vitals_lcp",
  "web_vitals_inp",
  "web_vitals_cls",
  "announcement_banner_view",
  "announcement_banner_cta_click",
  "announcement_banner_dismiss",
]);
