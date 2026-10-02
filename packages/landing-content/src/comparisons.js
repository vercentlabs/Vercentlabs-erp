/**
 * Comparisons — 1, not several: a comparison ships only where real buyer
 * intent, verifiable evidence, and a maintainable difference exist. Odoo
 * only: the most naturally adjacent, publicly documented competitor with real
 * fetchable pricing/edition data.
 * Every ODOO_COMPARISON_EVIDENCE claim traces to a real EDITORIAL_SOURCES
 * entry (sources.js), fetched live on 2026-08-07.
 *
 * Never "Vercentlabs is better than Odoo." Every comparison dimension is
 * framed both directions — where Odoo may be the stronger fit, where
 * Vercentlabs may be. Vercentlabs pricing is not published on this site
 * yet (no /pricing content exists), so this comparison neither states,
 * characterises, nor implies a Vercentlabs price point or pricing model —
 * doing so would be inventing a fact that doesn't exist in the product.
 */
export const ODOO_COMPARISON_EVIDENCE = Object.freeze([
  {
    claimId: "odoo-free-tier",
    competitor: "Odoo",
    claim: "Odoo offers a free \"One App Free\" plan — one app, unlimited users, on Odoo Online only.",
    sourceUrl: "https://www.odoo.com/pricing",
    sourceTitle: "Odoo Pricing",
    verifiedAt: "2026-08-07",
    sourceType: "vendor",
  },
  {
    claimId: "odoo-standard-plan",
    competitor: "Odoo",
    claim: "Odoo's Standard plan (all apps, Odoo Online only) was listed at ₹580–760 per user/month at time of retrieval, with pricing geo-localized and subject to change.",
    sourceUrl: "https://www.odoo.com/pricing",
    sourceTitle: "Odoo Pricing",
    verifiedAt: "2026-08-08",
    sourceType: "vendor",
  },
  {
    claimId: "odoo-custom-plan",
    competitor: "Odoo",
    claim: "Odoo's Custom plan adds Odoo Studio, multi-company support, external API access, and Odoo.sh/on-premise deployment options, listed at ₹890–1,140 per user/month at time of retrieval.",
    sourceUrl: "https://www.odoo.com/pricing",
    sourceTitle: "Odoo Pricing",
    verifiedAt: "2026-08-08",
    sourceType: "vendor",
  },
  {
    claimId: "odoo-community-open-source",
    competitor: "Odoo",
    claim: "Odoo's Community edition is open-source and free, with self-hosting and GitHub source access; Enterprise adds extra apps, infrastructure, and professional services on top.",
    sourceUrl: "https://www.odoo.com/",
    sourceTitle: "Odoo — Business Apps",
    verifiedAt: "2026-08-07",
    sourceType: "vendor",
  },
  {
    claimId: "odoo-app-breadth",
    competitor: "Odoo",
    claim: "Odoo organizes its suite into 8 broad domains (Finance, Sales, Websites, Supply Chain, Human Resources, Marketing, Services, Productivity) spanning dozens of individual apps, including website building, e-commerce, and marketing automation tools.",
    sourceUrl: "https://www.odoo.com/",
    sourceTitle: "Odoo — Business Apps",
    verifiedAt: "2026-08-07",
    sourceType: "vendor",
  },
]);

/**
 * 5-part dimension comparison, each side sourced independently: the Odoo
 * side traces to ODOO_COMPARISON_EVIDENCE (dated; refresh before relying on
 * time-sensitive details); the Vercentlabs side must stay inside the approved
 * launch capability register (capabilities/launch-capabilities.js) — never a matching,
 * unverified guess about what Odoo "must" also do.
 */
export const VERCENTLABS_VS_ODOO = Object.freeze({
  slug: "vercentlabs-vs-odoo",
  competitor: "Odoo",
  metaDescription: "A neutral, evidence-based comparison of Vercentlabs ERP and Odoo — deployment model, module scope, pricing structure, multi-company support, and where each may be the stronger fit.",
  searchIntent: "Vercentlabs vs Odoo",
  directAnswer:
    "Vercentlabs ERP and Odoo are both multi-module business platforms, but they differ in real, verifiable ways: Odoo's app catalog is broader (including website building, e-commerce, and marketing tools Vercentlabs doesn't offer), is available as a free, self-hostable open-source Community edition, and publishes transparent per-seat pricing. Vercentlabs is a narrower, operations-focused ERP with 12 business modules on one Shared Platform, with tenant isolation enforced by database row-level security and a database-protected audit log.",
  dimensions: [
    {
      id: "deployment-and-editions",
      title: "Deployment and editions",
      odoo: "Odoo offers a genuinely free, open-source Community edition with self-hosting and GitHub source access, plus a paid Enterprise tier (extra apps, infrastructure, professional services) available via Odoo Online (cloud), Odoo.sh, or on-premise.",
      vercentlabs: "Vercentlabs is a hosted, multi-tenant SaaS platform — each organisation's data is isolated by database row-level security within one hosted deployment model; there is no self-hosted or open-source edition.",
      evidenceIds: ["odoo-community-open-source"],
    },
    {
      id: "module-and-app-scope",
      title: "Module and app scope",
      odoo: "Odoo's catalog spans 8 broad domains and dozens of individual apps, including website building, e-commerce, blogging, live chat, and marketing automation — tools aimed at running a business's public-facing presence as well as its back office.",
      vercentlabs: "Vercentlabs covers 12 business modules (CRM, Sales, Accounting, Procurement, Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, Support, HR & Payroll) plus a Shared Platform — a narrower, operations-and-finance focus with no website/e-commerce/marketing-automation suite.",
      evidenceIds: ["odoo-app-breadth"],
    },
    {
      id: "pricing-structure",
      title: "Pricing structure",
      odoo: "Odoo publishes per-user, per-month pricing on its website across a free tier, a Standard plan, and a Custom plan. Its prices are geo-localized and change over time — check Odoo's pricing page for current figures.",
      vercentlabs: "Vercentlabs pricing is not yet published on this site, so this comparison doesn't state or estimate a Vercentlabs price. Ask us for current pricing for your modules and users.",
      evidenceIds: ["odoo-free-tier", "odoo-standard-plan", "odoo-custom-plan"],
    },
    {
      id: "multi-company-and-access-control",
      title: "Multi-company support and access control",
      odoo: "Multi-company support is available only by way of Odoo's Custom plan — adding a second company on the Free or Standard plan automatically upgrades the account to Custom pricing.",
      vercentlabs: "Several companies and branches per organisation, with company and branch access scoping, roles and permissions, and record-level access, are part of the Shared Platform.",
      evidenceIds: ["odoo-custom-plan"],
    },
    {
      id: "audit-and-governance",
      title: "Audit trail and governance",
      odoo: "Odoo's own public pages describe app breadth and editions but do not detail a specific audit-trail immutability mechanism — not evaluated here since no primary-source claim was found to cite.",
      vercentlabs: "Significant actions are written to a platform audit log that a database trigger protects — updates and deletions are rejected at the database level, not just hidden by a UI restriction. Leave and payroll approval are built in, and an approver can't approve a payroll that includes their own pay.",
      evidenceIds: [],
    },
  ],
  strongerFitForOdoo: [
    "An organisation that wants a genuinely free, self-hostable, open-source starting point with the option to extend the codebase directly.",
    "A business that needs website building, e-commerce, or marketing automation in the same platform as its back-office ERP, not as separate tools.",
    "A buyer who wants to compare published per-seat prices before any conversation with the vendor.",
  ],
  strongerFitForVercentlabs: [
    "An organisation whose primary need is connected operations — sales, stock, manufacturing, quality, and accounting on one data model — rather than a broad website/marketing app catalog.",
    "A multi-company business that wants company and branch access scoping as part of the core platform.",
    "A buyer that weighs a database-protected audit log as a real evaluation criterion, not just a checkbox feature.",
  ],
  faqs: [
    { question: "Is Odoo cheaper than Vercentlabs?", answer: "Odoo publishes pricing starting from a free tier. Vercentlabs pricing isn't published on this site yet, so this page doesn't compare prices — a fair comparison needs current pricing from both vendors for your actual modules and number of users." },
    { question: "Does Odoo have manufacturing and quality management like Vercentlabs?", answer: "Odoo's own pages list Manufacturing, PLM, and Quality within its Supply Chain domain — this comparison did not independently verify the depth of Odoo's manufacturing/quality feature set against Vercentlabs' own (BOM, manufacturing-order, and quality-hold capabilities documented on this site), since doing so honestly would require the same live, fetched verification standard applied to every other claim here. Treat that specific depth comparison as unverified rather than assumed either way." },
    { question: "Can I self-host Vercentlabs the way I can self-host Odoo Community?", answer: "No — Vercentlabs is a hosted, multi-tenant SaaS platform with no self-hosted or open-source edition, unlike Odoo's free Community edition." },
  ],
});

export function getComparisonEvidence(claimId) {
  return ODOO_COMPARISON_EVIDENCE.find((evidence) => evidence.claimId === claimId) || null;
}
