/**
 * The 3 primary ICPs from docs/landing-redesign/phase-1/icp-and-buyer-map.md.
 * `industrySlug` matches the /industries/{slug} route in
 * docs/landing-redesign/phase-1/information-architecture.md.
 */
export const LANDING_ICPS = Object.freeze([
  {
    slug: "manufacturing",
    industrySlug: "manufacturing",
    name: "Growing Manufacturers",
    triggerEvent: "A costly stockout, an OEM traceability requirement, or outgrowing an accounting-only tool.",
    primaryModules: ["manufacturing", "stock", "procurement", "quality", "accounting"],
    primaryWorkflow: "plan-to-production",
  },
  {
    slug: "distribution-retail",
    industrySlug: "distribution-retail",
    name: "Distributors & Multi-Location Retailers",
    triggerEvent: "Opening a new location, a stockout that lost a major account, or replacing an end-of-life POS vendor.",
    primaryModules: ["stock", "point-of-sale", "sales", "procurement", "crm"],
    primaryWorkflow: "retail-checkout-to-inventory",
  },
  {
    slug: "professional-services",
    industrySlug: "professional-services",
    name: "Project-Based & Professional Services Businesses",
    triggerEvent: "A project that looked profitable but wasn't, or scaling past what a spreadsheet PM process can hold.",
    primaryModules: ["projects", "crm", "sales", "accounting", "hr-payroll"],
    primaryWorkflow: "project-to-profitability",
  },
]);

export function getIcp(slug) {
  return LANDING_ICPS.find((icp) => icp.slug === slug) || null;
}
