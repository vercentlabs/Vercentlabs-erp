/**
 * The 3 primary ICPs — the buyer-research layer, not the page-presentation
 * layer. `industrySlugs` lists the real /industries/{slug} route(s) built
 * from each ICP. One ICP can map to several pages ("distribution-retail" is
 * served by /industries/distribution and /industries/retail without a 4th
 * ICP), so this is an array (1-to-many).
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
    triggerEvent: "Scaling past what a spreadsheet project tracker and separate customer tools can hold.",
    primaryModules: ["projects", "crm", "sales", "accounting", "hr-payroll"],
    primaryWorkflow: "project-to-profitability",
  },
]);

export function getIcp(slug) {
  return LANDING_ICPS.find((icp) => icp.slug === slug) || null;
}
