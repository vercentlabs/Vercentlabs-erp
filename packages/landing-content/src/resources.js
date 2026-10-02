import { LAUNCH_CAPABILITY_SUMMARY, LAUNCH_CAPABILITY_TOTAL } from "./capabilities/launch-capabilities.js";
import { CAPABILITY_GROUPS } from "./capabilities/capability-registry.js";
import { CTAS } from "./navigation.js";

/**
 * Cornerstone resource guides — 6, not the maximal 8-candidate list. Dropped inventory-management-guide and procurement-process-guide
 * as standalone pages: their real substance already lives on /modules/stock,
 * /modules/procurement, /workflows/order-to-fulfilment, /workflows/procure-to-pay,
 * and /industries/distribution — a standalone page would duplicate that
 * content, not add to it.
 *
 * erp-requirements-checklist's article metadata lives here (title, dek, faqs,
 * conversion) but its actual checklist body is built directly in its route
 * from CAPABILITY_GROUPS (capabilities/capability-registry.js), which groups the approved
 * launch capability register (capabilities/launch-capabilities.js) — structured,
 * crawlable capability data, not prose someone has to keep in sync by hand.
 *
 * Vercentlabs-specific statements must stay inside the approved launch
 * capability register; everything else is a vendor-neutral statement true of
 * ERP evaluation/implementation/migration generally (erp-buying-guide and
 * erp-implementation-checklist in particular are scoped to stay useful to a
 * buyer evaluating any ERP).
 */
export const RESOURCE_GUIDES = Object.freeze([
  {
    slug: "erp-buying-guide",
    category: "ERP Buying",
    title: "The ERP Buying Guide",
    dek: "A vendor-neutral framework for evaluating ERP software — what to actually check, what buyers commonly get wrong, and the questions worth asking any vendor, including this one.",
    keyTakeaways: [
      "Start from your most acute, quantifiable operational pain — not a feature checklist copied from a competitor's site.",
      "Data migration and integration scope are the two most commonly underestimated parts of an ERP decision.",
      "A phased, module-by-module rollout reduces change-management risk more than a full-system cutover.",
      "Ask every vendor for a real screenshot or live demo of the specific workflow you care about — not a slide deck.",
    ],
    sections: [
      {
        id: "start-with-pain-not-features",
        heading: "Start from your real operational pain, not a feature list",
        paragraphs: [
          "The most common ERP evaluation mistake is starting from a generic feature checklist — every vendor will check most of the boxes on a generic list, which tells you nothing about fit. Start instead from the specific, quantifiable pain your organisation actually has: a month-end close that takes two weeks because nobody trusts the numbers until they're reconciled by hand, a stockout that happened because nobody had real-time visibility into on-hand inventory, a quotation that took a week to get approved because it lived in an email thread.",
          "Write that pain down in concrete terms before you take a single vendor call. It becomes the filter every subsequent decision runs through — including which modules to implement first.",
        ],
      },
      {
        id: "which-modules-first",
        heading: "Which modules should you implement first?",
        paragraphs: [
          "Most organisations get the fastest real value by implementing the module that owns their most acute pain first, not by attempting a full-system rollout simultaneously. A distributor with stockout problems often starts with inventory and procurement; a services firm with margin visibility problems often starts with projects and accounting; a manufacturer drowning in spreadsheet BOMs often starts with manufacturing and stock together, since the two are structurally connected.",
          "A phased rollout also reduces change-management risk in a way that's easy to underestimate going in: a team learning one new governed process at a time adapts faster than a team facing a full-system cutover on day one, and each phase's real usage data informs configuration decisions for the next phase.",
        ],
      },
      {
        id: "data-migration-and-integration",
        heading: "Data migration and integration are the two most underestimated costs",
        paragraphs: [
          "Almost every ERP evaluation focuses heavily on feature comparison and under-invests in scoping data migration and integration — and these are consistently where real implementation timelines slip. Ask concretely: what happens to your existing customer, item, and supplier records? Who reconciles migrated data against the source system before go-live, and how? What existing tools (e-commerce, payment gateways, shipping carriers) need a real integration, not a manual export/import workaround?",
          "See the ERP Implementation Checklist and ERP Migration Guide for the specific, sequenced questions to ask on this — it's dense enough to deserve its own dedicated treatment rather than a summary here.",
        ],
      },
      {
        id: "questions-to-ask-any-vendor",
        heading: "Questions worth asking any vendor — including Vercentlabs",
        paragraphs: [
          "Ask for a real screenshot or live walkthrough of the specific workflow you care about, not a generic product tour. Ask what happens when two departments' data disagrees — is there a real audit trail, or does whoever edited last silently win? Ask how role-based access actually works: can access be scoped to a specific branch or time-bound to a contractor's engagement, or is it all-or-nothing? Ask what's explicitly not yet automated — a vendor that can name a real, current limitation is more trustworthy than one that claims full automation everywhere.",
        ],
      },
      {
        id: "vercentlabs-context",
        heading: "Where Vercentlabs fits into this framework",
        paragraphs: [
          `Vercentlabs ERP is a multi-tenant, multi-company platform with ${LAUNCH_CAPABILITY_SUMMARY} — the Requirements Checklist on this site lets you evaluate that approved scope against the framework above using the same structured, filterable list this guide describes, whether or not you end up choosing Vercentlabs.`,
        ],
      },
    ],
    faqs: [
      { question: "How long does an ERP evaluation typically take?", answer: "This varies enormously by organisation size and how many stakeholders need to sign off — there's no universal number worth citing here. What matters more than speed is whether the evaluation actually tested the specific workflow your pain is centered on, not just watched a generic demo." },
      { question: "Should we build a custom system instead of buying ERP software?", answer: "That's a real, legitimate option for a narrow, well-understood process — but it means owning ongoing maintenance, security patching, and feature development yourself indefinitely. Most organisations find that cost compounds faster than expected once the process needs to change." },
      { question: "Is a free or open-source ERP a safe first step?", answer: "It can be, for organisations with in-house engineering capacity to self-host, patch, and extend it. The real cost to evaluate honestly is total cost of ownership over several years, not just license price — hosting, customization, and support all have to come from somewhere." },
    ],
    relatedModuleKeys: ["stock", "procurement", "accounting", "projects", "manufacturing"],
    relatedWorkflowSlugs: [],
    relatedResourceSlugs: ["erp-requirements-checklist", "erp-implementation-checklist", "erp-vs-spreadsheets"],
    metaDescription: "A vendor-neutral ERP buying guide: how to evaluate ERP software based on real operational pain, which modules to implement first, and the questions worth asking any vendor.",
    searchIntent: "how to choose ERP software",
    conversion: { heading: "See whether Vercentlabs fits the framework above.", ctaLabel: CTAS.talkToSpecialist.label },
  },
  {
    slug: "erp-requirements-checklist",
    category: "Requirements",
    title: "The ERP Requirements Checklist",
    dek: `A structured, filterable checklist built from Vercentlabs ERP's ${LAUNCH_CAPABILITY_SUMMARY} — usable as a neutral evaluation framework for any ERP decision, not just this one.`,
    keyTakeaways: [
      `${LAUNCH_CAPABILITY_TOTAL} approved MVP capabilities in ${CAPABILITY_GROUPS.length} groups, across the business modules and the Shared Platform — filterable by module below.`,
      "Every group links to the page describing that part of Vercentlabs ERP.",
      "Your selections stay in your browser only — nothing is sent anywhere unless you explicitly choose to.",
    ],
    sections: [
      {
        id: "how-to-use-this",
        heading: "How to use this checklist",
        paragraphs: [
          "This checklist is organised by module and platform capability area, mirroring the real structure of an ERP evaluation — not a flat, undifferentiated list. Use the filter below to focus on one module or capability area at a time, or work through the full list. Checking an item marks it for your own reference only; nothing is transmitted anywhere, and nothing requires an account or a form.",
          "This is a genuinely reusable evaluation framework: the module/capability breakdown below reflects real ERP domains (CRM, sales, accounting, procurement, inventory, manufacturing, and more), so it's structured to be useful whether or not Vercentlabs ends up being the right fit.",
        ],
      },
    ],
    faqs: [
      { question: "Is my progress saved if I close the browser?", answer: "Yes — your checked items are saved to your browser's local storage, not to a server, so they persist across visits on the same device and browser but are never visible to Vercentlabs or transmitted anywhere." },
      { question: "Can I print this checklist?", answer: "Yes — the Print button opens your browser's print dialog with a layout suited for printing; the filter and checkbox controls are hidden in the printed version so you get a clean capability list." },
      { question: "Does this list every capability individually?", answer: `Yes — each group lists the approved MVP capabilities it contains, ${LAUNCH_CAPABILITY_TOTAL} in total across ${CAPABILITY_GROUPS.length} groups. These are Vercentlabs ERP's approved launch scope, the same groups its module pages use.` },
    ],
    relatedModuleKeys: [],
    relatedWorkflowSlugs: [],
    relatedResourceSlugs: ["erp-buying-guide", "erp-implementation-checklist"],
    metaDescription: `A structured, filterable ERP requirements checklist built from Vercentlabs ERP's ${LAUNCH_CAPABILITY_SUMMARY} — no login required, nothing transmitted.`,
    searchIntent: "ERP requirements checklist",
    conversion: { heading: "See the checklist items you cared about most, live in the product.", ctaLabel: CTAS.talkToSpecialist.label },
  },
  {
    slug: "erp-implementation-checklist",
    category: "Implementation",
    title: "The ERP Implementation Checklist",
    dek: "A generic, vendor-neutral checklist for any ERP implementation — discovery through post-launch support — distinct from Vercentlabs' own specific implementation journey.",
    keyTakeaways: [
      "Data migration reconciliation is the single most commonly underestimated line item.",
      "Configuration (roles, numbering, approval thresholds) deserves as much planning time as feature selection.",
      "A named post-launch support period, not just a go-live date, is what separates a real plan from a rushed one.",
    ],
    sections: [
      {
        id: "discovery",
        heading: "Discovery and requirements gathering",
        paragraphs: [
          "Before any configuration begins, a real implementation plan documents current-state processes (even the informal, undocumented ones), the specific pain points driving the project, and which stakeholders need to sign off on what. Skipping this step is the single most common cause of a implementation that technically launches but doesn't actually fix the real problem.",
        ],
      },
      {
        id: "data-migration",
        heading: "Data migration and reconciliation",
        paragraphs: [
          "Migrating customers, items, suppliers, and open transactions is necessary but not sufficient — the step that's commonly skipped or rushed is reconciliation: confirming the migrated data actually matches the source system record for record, not just that a migration script completed without erroring. Budget real time for this, and assign a specific owner, not \"the implementation team\" as a vague catch-all.",
        ],
      },
      {
        id: "configuration",
        heading: "Configuration: roles, numbering, and approval thresholds",
        paragraphs: [
          "Configuration decisions — who can approve what, at what dollar threshold, and how documents are numbered — deserve as much planning attention as which modules to buy. A role structure copied uncritically from a generic template rarely matches a specific organisation's real approval chain, and retrofitting it after go-live is more disruptive than getting it right upfront.",
        ],
      },
      {
        id: "testing-and-training",
        heading: "Integration testing and user training",
        paragraphs: [
          "Test the specific workflows your organisation actually runs, not just a generic smoke test — the order-to-invoice sequence a real sales team will use, the purchase-to-payment sequence a real buyer will use. Training that happens once, weeks before go-live, is consistently less effective than training scheduled close to go-live with a real, hands-on task to complete.",
        ],
      },
      {
        id: "cutover-and-post-launch",
        heading: "Cutover plan and post-launch support",
        paragraphs: [
          "A real cutover plan names a specific go-live date, a rollback contingency if something goes materially wrong, and — critically — a defined post-launch support period with a named point of contact, not an assumption that go-live is the finish line. The weeks immediately after go-live are when real usage surfaces gaps a testing phase didn't catch.",
        ],
      },
    ],
    faqs: [
      { question: "How is this different from Vercentlabs' own implementation page?", answer: "This checklist is intentionally generic — usable to plan an implementation with any ERP vendor. Vercentlabs' own implementation journey (see /implementation) describes the real, specific phases and data-migration process this product's implementations actually follow." },
      { question: "What's the biggest implementation risk teams underestimate?", answer: "Data migration reconciliation and configuration (roles, numbering, approval thresholds) are the two most consistently underestimated line items — both are described above, and both deserve more planning time than they typically get relative to feature selection." },
    ],
    relatedModuleKeys: [],
    relatedWorkflowSlugs: [],
    relatedResourceSlugs: ["erp-migration-guide", "erp-buying-guide"],
    metaDescription: "A generic, vendor-neutral ERP implementation checklist covering discovery, data migration, configuration, testing, training, cutover, and post-launch support.",
    searchIntent: "ERP implementation checklist",
    conversion: { heading: "See what Vercentlabs' own implementation journey actually looks like.", ctaLabel: "See the implementation journey" },
  },
  {
    slug: "erp-migration-guide",
    category: "Implementation",
    title: "The ERP Data Migration Guide",
    dek: "What actually has to happen to move real data into a new ERP system — and why no honest migration is fully automatic.",
    keyTakeaways: [
      "Reconciliation, not the migration script itself, is where real risk lives.",
      "Open transactions (unpaid invoices, in-progress orders) are harder to migrate than static master data and deserve extra scrutiny.",
      "No credible migration process eliminates manual verification entirely — treat any claim that it does with real skepticism.",
    ],
    sections: [
      {
        id: "what-actually-migrates",
        heading: "What actually needs to migrate",
        paragraphs: [
          "A real migration scope typically includes master data (customers, suppliers, items, bills of materials, chart of accounts) and open transactions (unpaid invoices, open purchase orders, in-progress work orders) — closed, historical transactions are sometimes migrated in summary form rather than record-by-record, since the operational need to act on them has passed. Decide this scope explicitly and early; it's a real cost/completeness tradeoff, not an oversight to gloss over.",
        ],
      },
      {
        id: "master-data-vs-open-transactions",
        heading: "Master data is easier than open transactions",
        paragraphs: [
          "Static master data (an item's name, unit of measure, a customer's billing address) is comparatively straightforward to migrate and validate. Open transactions are harder: an in-progress purchase order has to land in the new system at the correct lifecycle stage, not just as a flat record, or the receiving and invoicing process breaks when someone tries to act on it. Give open-transaction migration extra scrutiny and a dedicated reconciliation pass.",
        ],
      },
      {
        id: "reconciliation-is-the-real-work",
        heading: "Reconciliation is where the real risk lives",
        paragraphs: [
          "A migration script completing without an error is not the same as a migration being correct — record counts matching, sample records spot-checked field by field against the source system, and financial totals (like accounts receivable aging) tying out are what actually confirm a migration succeeded. Budget real time and a named owner for this step; it is not optional busywork.",
        ],
      },
      {
        id: "no-universal-automation",
        heading: "No credible migration process is fully automatic",
        paragraphs: [
          "Be skeptical of any vendor claiming a fully automated, zero-manual-verification migration — real source systems have real inconsistencies (duplicate customer records, inconsistent unit-of-measure conventions, stale supplier data) that automated tooling can flag but rarely resolves correctly without a human decision. A credible migration process names the manual verification steps explicitly rather than implying they don't exist.",
        ],
      },
    ],
    faqs: [
      { question: "How long does ERP data migration typically take?", answer: "This depends heavily on data volume, source-system quality, and how much of it is open transactions versus static master data — there's no honest universal number to cite here. Treat any vendor quoting a specific timeline before seeing your real data with real skepticism." },
      { question: "Can historical data always be fully migrated?", answer: "Not always in full record-level detail — many organisations migrate closed/historical transactions in summarized form rather than record-by-record, since the operational need to act on them individually has passed, while master data and open transactions get full-fidelity migration." },
    ],
    relatedModuleKeys: [],
    relatedWorkflowSlugs: [],
    relatedResourceSlugs: ["erp-implementation-checklist", "erp-buying-guide"],
    metaDescription: "A vendor-neutral guide to ERP data migration: what actually needs to migrate, why reconciliation matters more than the migration script, and why no credible process is fully automatic.",
    searchIntent: "ERP data migration process",
    conversion: { heading: "See Vercentlabs' own real data-migration process.", ctaLabel: "See the implementation journey" },
  },
  {
    slug: "manufacturing-erp-guide",
    category: "Manufacturing",
    title: "The Manufacturing ERP Guide",
    dek: "What manufacturing ERP actually needs to do — bills of materials, manufacturing orders, material planning — and which pieces Vercentlabs ERP covers at launch.",
    keyTakeaways: [
      "A bill of materials is the structural input every downstream manufacturing step depends on.",
      "Material requirements planning turns a production plan into a concrete purchasing/production plan.",
      "The real test of manufacturing ERP is whether the shop floor and finance see the same live records — not two systems reconciled after the fact.",
    ],
    sections: [
      {
        id: "what-manufacturing-erp-covers",
        heading: "What manufacturing ERP actually needs to cover",
        paragraphs: [
          "Manufacturing ERP needs to cover the full production sequence — a bill of materials defining what a finished item is made of, a routing defining how it's made, a work order that's released and tracked against real component availability, and material/capacity planning that turns a demand signal into concrete purchase and production actions. The real differentiator versus a standalone MRP tool is connection: a work order that consumes real stock and feeds real cost data into financial reporting, not an isolated production tracker beside a separately managed inventory system.",
        ],
      },
      {
        id: "bom-and-routing",
        heading: "Bills of materials and routings",
        paragraphs: [
          "A bill of materials' accuracy directly determines whether production can run as planned — an incomplete or stale BOM produces an order that can't actually be fulfilled. In Vercentlabs ERP, manufacturing orders are created from the item's bill of materials. Routings and work centers are not part of the launch product.",
          "See the Manufacturing module and the Plan to Production workflow for the real, full sequence.",
        ],
      },
      {
        id: "work-order-release-gating",
        heading: "Production should start only when the materials are there",
        paragraphs: [
          "An order started without the components it needs is a common source of shop-floor disruption — production starts, then stalls partway through because a component wasn't actually there. Vercentlabs ERP checks material availability for each manufacturing order against its bill of materials before production starts.",
        ],
      },
      {
        id: "mrp-honest-limitations",
        heading: "Material requirements planning — not part of the launch product",
        paragraphs: [
          "MRP and capacity planning runs compare a demand signal against current stock and open supply and produce recommended purchase, manufacture, transfer, or expedite actions. Vercentlabs ERP does not include MRP or capacity planning at launch — purchasing decisions are made from real-time stock balances and each order's material availability check.",
        ],
      },
      {
        id: "connection-to-finance-and-inventory",
        heading: "Connection to inventory and finance, not an isolated production tracker",
        paragraphs: [
          "In Vercentlabs ERP, material issues and finished-goods receipts post to the same stock ledger the rest of the business uses, feeding inventory valuation, and each manufacturing order records its production cost — no separate reconciliation between a production tracker and inventory.",
        ],
      },
    ],
    faqs: [
      { question: "What does Vercentlabs Manufacturing cover at launch?", answer: "Bills of materials, manufacturing orders, material availability, material issue and consumption, scrap, production quality inspections and holds, finished-goods receipt, and production costing." },
      { question: "Does Vercentlabs ERP include MRP?", answer: "No. MRP and capacity planning are not part of the launch product; manufacturing orders check material availability against their bill of materials instead." },
      { question: "What happens if there isn't enough raw material for an order?", answer: "The manufacturing order's material availability check shows the shortfall against its bill of materials before production starts." },
    ],
    relatedModuleKeys: ["manufacturing", "stock"],
    relatedWorkflowSlugs: ["plan-to-production"],
    relatedResourceSlugs: ["erp-vs-spreadsheets", "erp-buying-guide"],
    metaDescription: "What manufacturing ERP actually needs to cover — bills of materials, material availability, material requirements planning — and which pieces Vercentlabs ERP covers at launch, stated plainly.",
    searchIntent: "manufacturing ERP software",
    conversion: { heading: "Walk through bills of materials and manufacturing orders with an ERP specialist.", ctaLabel: CTAS.talkToSpecialist.label },
  },
  {
    slug: "erp-vs-spreadsheets",
    category: "Product Education",
    title: "ERP vs. Spreadsheets",
    dek: "A nuanced look at when spreadsheets genuinely remain the right tool, and when their limitations become a real operational cost.",
    keyTakeaways: [
      "Spreadsheets remain a genuinely good fit for small-scale, single-owner, low-concurrency tracking.",
      "The real failure mode is multiple people editing the same shared fact with no single source of truth or audit trail.",
      "The right question isn't \"spreadsheets or ERP\" in the abstract — it's whether your specific process still fits a spreadsheet's real constraints.",
    ],
    sections: [
      {
        id: "when-spreadsheets-are-fine",
        heading: "When spreadsheets are genuinely the right tool",
        paragraphs: [
          "This isn't a one-sided argument — spreadsheets are a real, appropriate tool for small-scale, single-owner tracking: a one-person consulting business's expense log, an early-stage team's simple task list, a one-off analysis that doesn't need to persist as a system of record. If only one person edits a given sheet and the data doesn't feed downstream financial or operational decisions other people rely on, a spreadsheet's flexibility is a genuine advantage, not a liability.",
        ],
      },
      {
        id: "where-spreadsheets-break-down",
        heading: "Where spreadsheets break down",
        paragraphs: [
          "The real failure mode isn't spreadsheets in general — it's a spreadsheet being used as a shared, multi-editor system of record for a fact multiple departments depend on: an item master edited independently by sales and warehouse teams, a pricing sheet with no record of who changed a number or when, an invoice numbering scheme that's a manually incremented cell someone eventually gets wrong. At that point, the cost isn't hypothetical — it's staff time spent reconciling drift between copies, and real errors that a shared, validated system would have caught structurally.",
        ],
      },
      {
        id: "what-replaces-it",
        heading: "What a connected system actually changes",
        paragraphs: [
          "The core structural difference is that departments read and write the same underlying record instead of syncing copies after the fact — a sales order and the invoice it generates are the same transaction seen from two modules, not two documents kept aligned by hand. Governed numbering series remove the manually incremented cell. A database-enforced audit trail replaces a version-history tab someone forgot to keep updated.",
        ],
      },
      {
        id: "the-real-question",
        heading: "The question worth actually asking",
        paragraphs: [
          "Rather than \"spreadsheets or ERP\" as an abstract choice, ask concretely: does more than one person edit this data? Does another department's decision depend on this data being current and correct? Has this sheet ever caused a real error because two people edited it at once, or because a formula broke when a column was inserted? If the honest answer to any of those is yes, the spreadsheet has likely already become the more expensive option — just with the cost hidden in staff time rather than a line item.",
        ],
      },
    ],
    faqs: [
      { question: "Is this guide saying spreadsheets are always bad?", answer: "No — spreadsheets are a genuinely good fit for small-scale, single-owner, low-concurrency tracking. The real problem is specific: multiple people editing the same shared fact with no single source of truth, validation, or audit trail." },
      { question: "How do I know if we've outgrown spreadsheets?", answer: "See the three concrete questions in \"The question worth actually asking\" above — multi-editor access, cross-department dependency, and whether a real error has already happened because of concurrent editing or a broken formula are the honest signals, not a vague sense that \"we should upgrade.\"" },
    ],
    relatedModuleKeys: ["stock", "sales", "procurement"],
    relatedWorkflowSlugs: [],
    relatedResourceSlugs: ["erp-buying-guide", "manufacturing-erp-guide"],
    metaDescription: "A nuanced comparison of ERP and spreadsheets — where spreadsheets remain the right tool, where they genuinely break down, and the concrete questions worth asking before deciding.",
    searchIntent: "ERP vs spreadsheets",
    conversion: { heading: "See what replaces your spreadsheet processes in Vercentlabs.", ctaLabel: CTAS.talkToSpecialist.label },
  },
]);

export function getResourceGuide(slug) {
  return RESOURCE_GUIDES.find((guide) => guide.slug === slug) || null;
}

export function getResourceGuidesForModule(moduleKey) {
  return RESOURCE_GUIDES.filter((guide) => guide.relatedModuleKeys.includes(moduleKey));
}

export const RESOURCE_CATEGORIES = Object.freeze([...new Set(RESOURCE_GUIDES.map((guide) => guide.category))]);
