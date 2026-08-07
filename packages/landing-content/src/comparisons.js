/**
 * Comparisons — 1, not several (see docs/landing-redesign/phase-6/
 * comparison-policy.md). Odoo only this phase: the most naturally adjacent,
 * publicly documented competitor with real fetchable pricing/edition data.
 * Every ODOO_COMPARISON_EVIDENCE claim traces to a real EDITORIAL_SOURCES
 * entry (sources.js), fetched live via WebFetch on 2026-08-07 — see
 * .claude/rules/landing-content.md rule 7 and comparison-evidence-register.md.
 *
 * Never "Vercentlabs is better than Odoo." Every comparison dimension is
 * framed both directions — where Odoo may be the stronger fit, where
 * Vercentlabs may be. Vercentlabs does not publish public per-seat pricing
 * anywhere on this site (no /pricing content exists yet), so this
 * comparison does not claim or imply a specific Vercentlabs price point —
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
    claim: "Odoo's Standard plan (all apps, Odoo Online only) was listed at ₹580–950 per user/month at time of retrieval, with pricing geo-localized and subject to change.",
    sourceUrl: "https://www.odoo.com/pricing",
    sourceTitle: "Odoo Pricing",
    verifiedAt: "2026-08-07",
    sourceType: "vendor",
  },
  {
    claimId: "odoo-custom-plan",
    competitor: "Odoo",
    claim: "Odoo's Custom plan adds Odoo Studio, multi-company support, external API access, and Odoo.sh/on-premise deployment options, listed at ₹890–1,420 per user/month at time of retrieval.",
    sourceUrl: "https://www.odoo.com/pricing",
    sourceTitle: "Odoo Pricing",
    verifiedAt: "2026-08-07",
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
 * side traces to ODOO_COMPARISON_EVIDENCE; the Vercentlabs side traces to
 * docs/landing-redesign/phase-1/product-intelligence.md and real code —
 * never a matching, unverified guess about what Odoo "must" also do.
 */
export const VERCENTLABS_VS_ODOO = Object.freeze({
  slug: "vercentlabs-vs-odoo",
  competitor: "Odoo",
  metaDescription: "A neutral, evidence-based comparison of Vercentlabs ERP and Odoo — deployment model, module scope, pricing structure, multi-company support, and where each may be the stronger fit.",
  searchIntent: "Vercentlabs vs Odoo",
  directAnswer:
    "Vercentlabs ERP and Odoo are both multi-module business platforms, but they differ in real, verifiable ways: Odoo's app catalog is broader (including website building, e-commerce, and marketing tools Vercentlabs doesn't offer), is available as a free, self-hostable open-source Community edition, and publishes transparent per-seat pricing. Vercentlabs is a narrower, operations-focused 12-module ERP with structural multi-tenant/multi-company isolation and a database-trigger-immutable audit trail built into the platform layer itself, not gated to a higher tier.",
  dimensions: [
    {
      id: "deployment-and-editions",
      title: "Deployment and editions",
      odoo: "Odoo offers a genuinely free, open-source Community edition with self-hosting and GitHub source access, plus a paid Enterprise tier (extra apps, infrastructure, professional services) available via Odoo Online (cloud), Odoo.sh, or on-premise.",
      vercentlabs: "Vercentlabs is a multi-tenant SaaS platform — organizations, companies, branches, and departments are structurally isolated within one hosted deployment model; there is no self-hosted or open-source edition.",
      evidenceIds: ["odoo-community-open-source"],
    },
    {
      id: "module-and-app-scope",
      title: "Module and app scope",
      odoo: "Odoo's catalog spans 8 broad domains and dozens of individual apps, including website building, e-commerce, blogging, live chat, and marketing automation — tools aimed at running a business's public-facing presence as well as its back office.",
      vercentlabs: "Vercentlabs covers 12 operational modules (CRM, Sales, Accounting, Procurement, Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, Support, HR & Payroll) plus a shared platform layer — a narrower, operations-and-finance focus with no website/e-commerce/marketing-automation suite.",
      evidenceIds: ["odoo-app-breadth"],
    },
    {
      id: "pricing-structure",
      title: "Pricing structure",
      odoo: "Odoo publishes transparent per-user, per-month pricing across a free tier, a Standard plan, and a Custom plan (₹580–1,420/user/month range at time of retrieval, geo-localized and subject to change).",
      vercentlabs: "Vercentlabs does not currently publish public per-seat pricing on this site — pricing is quote-based. This comparison does not estimate or imply a Vercentlabs price point, since no public figure exists to cite honestly.",
      evidenceIds: ["odoo-free-tier", "odoo-standard-plan", "odoo-custom-plan"],
    },
    {
      id: "multi-company-and-access-control",
      title: "Multi-company support and access control",
      odoo: "Multi-company support is specifically an Odoo Custom-plan feature, not available on the free or Standard plans.",
      vercentlabs: "Structural multi-company and branch isolation, plus scoped and time-bound role assignments, are core platform capabilities available across the product — not gated to a higher tier.",
      evidenceIds: ["odoo-custom-plan"],
    },
    {
      id: "audit-and-governance",
      title: "Audit trail and governance",
      odoo: "Odoo's own public pages describe app breadth and editions but do not detail a specific audit-trail immutability mechanism — not evaluated here since no primary-source claim was found to cite.",
      vercentlabs: "Every record change writes to an audit table a Postgres trigger makes immutable — UPDATE and DELETE are rejected at the database level, not just hidden by a UI restriction. Self-approval is blocked structurally across HR, Assets, Accounting, Procurement, and Projects.",
      evidenceIds: [],
    },
  ],
  strongerFitForOdoo: [
    "An organisation that wants a genuinely free, self-hostable, open-source starting point with the option to extend the codebase directly.",
    "A business that needs website building, e-commerce, or marketing automation in the same platform as its back-office ERP, not as separate tools.",
    "A buyer who wants fully transparent, published per-seat pricing before any sales conversation.",
  ],
  strongerFitForVercentlabs: [
    "An organisation whose primary need is operational ERP depth (manufacturing, quality, multi-company accounting) rather than a broad website/marketing app catalog.",
    "A multi-entity business that needs structural company/branch isolation and time-bound scoped roles as a standard platform capability, not a higher-tier add-on.",
    "A buyer that weighs a database-enforced, trigger-immutable audit trail as a real evaluation criterion, not just a checkbox feature.",
  ],
  faqs: [
    { question: "Is Odoo cheaper than Vercentlabs?", answer: "Odoo publishes transparent pricing starting from a free tier; Vercentlabs is quote-based with no public price to compare against. A fair cost comparison requires getting an actual Vercentlabs quote for your real module and seat count, not comparing a published number against an unpublished one." },
    { question: "Does Odoo have manufacturing and quality management like Vercentlabs?", answer: "Odoo's own pages list Manufacturing, PLM, and Quality within its Supply Chain domain — this comparison did not independently verify the depth of Odoo's manufacturing/quality feature set against Vercentlabs' own (BOM/work-order/quality-hold mechanics documented on this site), since doing so honestly would require the same live, fetched verification standard applied to every other claim here. Treat that specific depth comparison as unverified rather than assumed either way." },
    { question: "Can I self-host Vercentlabs the way I can self-host Odoo Community?", answer: "No — Vercentlabs is a hosted, multi-tenant SaaS platform with no self-hosted or open-source edition, unlike Odoo's free Community edition." },
  ],
});

export function getComparisonEvidence(claimId) {
  return ODOO_COMPARISON_EVIDENCE.find((evidence) => evidence.claimId === claimId) || null;
}
