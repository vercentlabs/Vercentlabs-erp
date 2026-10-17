/**
 * The 3 primary ICPs from docs/landing-redesign/phase-1/icp-and-buyer-map.md —
 * unchanged since Phase 1; this is the real buyer-research layer, not the
 * page-presentation layer. `industrySlugs` lists the real /industries/{slug}
 * route(s) built from each ICP. Phase 5 split "distribution-retail" into two
 * pages (/industries/distribution, /industries/retail) without inventing a
 * 4th ICP — see docs/landing-redesign/phase-5/decision-log.md item 2 — so
 * this is an array (1-to-many), not the singular `industrySlug` string this
 * field used to be before that split (a stale "distribution-retail" route
 * value would have 404'd here otherwise).
 */
export const LANDING_ICPS = Object.freeze([
  {
    slug: "manufacturing",
    industrySlugs: ["manufacturing"],
    name: "Growing Manufacturers",
    triggerEvent: "A costly stockout, an OEM traceability requirement, or outgrowing an accounting-only tool.",
    primaryModules: ["manufacturing", "stock", "procurement", "quality", "accounting"],
    primaryWorkflow: "plan-to-production",
  },
  {
    slug: "distribution-retail",
    industrySlugs: ["distribution", "retail"],
    name: "Distributors & Multi-Location Retailers",
    triggerEvent: "Opening a new location, a stockout that lost a major account, or replacing an end-of-life POS vendor.",
    primaryModules: ["stock", "point-of-sale", "sales", "procurement", "crm"],
    primaryWorkflow: "retail-checkout-to-inventory",
  },
  {
    slug: "professional-services",
    industrySlugs: ["professional-services"],
    name: "Project-Based & Professional Services Businesses",
    triggerEvent: "A project that looked profitable but wasn't, or scaling past what a spreadsheet PM process can hold.",
    primaryModules: ["projects", "crm", "sales", "accounting", "hr-payroll"],
    primaryWorkflow: "project-to-profitability",
  },
]);

export function getIcp(slug) {
  return LANDING_ICPS.find((icp) => icp.slug === slug) || null;
}
