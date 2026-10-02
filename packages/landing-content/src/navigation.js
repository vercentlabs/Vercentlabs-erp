/**
 * Global navigation and the CTA contract.
 *
 * `navGroup` values in MODULE_NAV_GROUPS must match the `navGroup` field
 * assigned to each module in modules/*.js. The groups are reading aids for the
 * module map, not industries or target markets.
 */
export const MODULE_NAV_GROUPS = Object.freeze([
  { key: "revenue", label: "Revenue", moduleKeys: ["crm", "sales", "point-of-sale"] },
  { key: "operations", label: "Operations", moduleKeys: ["procurement", "stock", "manufacturing", "quality"] },
  { key: "finance", label: "Finance", moduleKeys: ["accounting", "assets"] },
  { key: "people-and-service", label: "People & Service", moduleKeys: ["hr-payroll", "support"] },
  { key: "delivery", label: "Delivery", moduleKeys: ["projects"] },
]);

/**
 * Header navigation. Industries and Solutions are deliberately not top-level:
 * they are use-case entry points (footer and contextual links), not the brand.
 * Every href must be a real route (enforced by apps/landing tests).
 */
export const PRIMARY_NAV = Object.freeze([
  {
    label: "Product",
    href: "/product",
    children: [
      { label: "Product Overview", href: "/product" },
      { label: "Platform", href: "/product/platform" },
      { label: "Built-In Controls", href: "/product/automation" },
      { label: "Reporting", href: "/product/analytics" },
      { label: "Responsive Access", href: "/product/mobile" },
      { label: "Import & Export", href: "/product/integrations" },
      { label: "Security", href: "/security" },
      { label: "Implementation", href: "/implementation" },
    ],
  },
  { label: "Modules", href: "/modules" },
  { label: "Workflows", href: "/workflows" },
  { label: "Resources", href: "/resources" },
  { label: "Security", href: "/security" },
]);

/**
 * The global CTA contract — the one place the site's conversion hierarchy is
 * defined. Components render these by role, never by hard-coded label:
 *
 *   primary          the main evaluation action (header, hero, final CTA,
 *                    sticky mobile bar, footer). Today: explore the public
 *                    product pages. When a self-serve trial is approved and
 *                    built, change this entry — not the components.
 *   talkToSpecialist assisted evaluation via the /book-demo lead form.
 *   bookDemo         the same form, for contexts that explicitly ask for a
 *                    tailored demo (campaign and sales-assisted pages).
 *
 * "Sign in" is the remaining utility action; its URL comes from the
 * deployment (NEXT_PUBLIC_APP_URL), so only its label lives here.
 *
 * Labels name the action and the object — never "Learn More"/"Get Started" —
 * and never promise an experience that doesn't exist (no trial, sandbox, live
 * demo, or product tour).
 */
export const CTAS = Object.freeze({
  primary: Object.freeze({ label: "Explore the ERP", href: "/product" }),
  talkToSpecialist: Object.freeze({ label: "Talk to an ERP Specialist", href: "/book-demo?intent=specialist" }),
  bookDemo: Object.freeze({ label: "Book a Demo", href: "/book-demo" }),
});

export const SIGN_IN_LABEL = "Sign in";

/**
 * Site-wide top announcement bar (components/layout/announcement-banner.tsx).
 * Only for a real, time-bound announcement — set to null when there is none,
 * and the bar doesn't render. `id` is a dismissal key stored in localStorage:
 * use a new id for each new announcement. No fabricated offers or amounts.
 */
export const ANNOUNCEMENT_BANNER = null;

/**
 * Analytics event names not tied to a specific homepage section (those are
 * declared per-section via `analyticsId` in homepage.js instead — see
 * apps/landing/lib/analytics.ts's HomepageAnalyticsId type). This array and
 * index.d.ts's ANALYTICS_EVENTS tuple type must be kept in exact sync —
 * nothing at runtime validates track() calls against this array, so drift
 * would otherwise typecheck clean. tests/analytics-events-sync.test.mjs parses
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
