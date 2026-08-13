/**
 * The 8-phase implementation journey — Tier 4, P0 in
 * docs/landing-redesign/phase-1/information-architecture.md, explicitly
 * required by conversion-architecture.md's objection-handling stage ("we
 * tried an ERP before and it failed" is a named objection in
 * icp-and-buyer-map.md for every ICP).
 *
 * Data migration is integrated into the "Data Migration" phase below rather
 * than built as a separate /implementation/migration route — the IA doc lists
 * no dedicated migration route, and the governing prompt for this phase
 * explicitly allows either. See docs/landing-redesign/phase-5/decision-log.md.
 *
 * No specific timeframes, durations, or completion-rate guarantees appear
 * anywhere below — CLAUDE.md's evidence rules explicitly forbid fabricating
 * migration times or support-response guarantees. This describes a real
 * methodology, not a service-level commitment.
 */
export const IMPLEMENTATION_PAGE = Object.freeze({
  slug: "/implementation",
  title: "Implementation & Migration",
  metaDescription:
    "How a Vercentlabs ERP implementation actually runs, phase by phase — discovery through post-launch — including how customers, items, suppliers, and open transactions get migrated and reconciled.",
  directDefinition:
    "Implementation is an 8-phase methodology — discovery, solution design, configuration, data migration, testing, training, launch, and post-launch — that maps your real processes to the product before go-live, not a generic onboarding checklist run the same way for every customer.",
  searchIntent: "ERP implementation methodology",
  eyebrow: "Implementation journey",
  heading: "How implementation actually runs, phase by phase.",
  supportingText:
    "\"We tried an ERP before and it failed\" is a real, named objection — implementation risk, not product doubt. This is the honest, code-grounded version of what actually happens between signing and go-live.",
  phases: [
    {
      id: "discovery",
      name: "Discovery",
      description:
        "Before any configuration happens, discovery maps your real processes — not a generic template. This is where a manufacturer's actual BOM complexity, a distributor's warehouse count, or a services firm's billing models get understood directly, matching the evaluation criteria a real buying committee actually checks.",
      activities: [
        "Document current systems and where data actually lives today (spreadsheets, Tally/QuickBooks/Zoho, a legacy or point tool)",
        "Map real business processes module by module — which of the 12 modules apply, and which capability groups within them matter most",
        "Identify the specific workflows that matter most (e.g. plan-to-production, procure-to-pay, hire-to-payroll)",
        "Surface honest scope questions early — what the product does and does not do today, referenced against real capability groups, not assumed",
      ],
      typicalOutputs: ["A documented current-state process map", "A confirmed module scope for the implementation"],
    },
    {
      id: "solution-design",
      name: "Solution Design",
      description:
        "Discovery's findings become a concrete design: which modules, which workflows, and how the platform's shared structures — companies, branches, roles, numbering — map to your real organisation.",
      activities: [
        "Design the company/branch/department structure for multi-entity or multi-location organisations",
        "Design the role and permission model — which of the platform's seeded roles apply, and where scoped or time-bound assignments are needed",
        "Plan approval thresholds and governance rules (quotation approval limits, journal approval thresholds, matching tolerances) against real policy, not defaults left unexamined",
        "Confirm the numbering-series scheme for invoices, purchase orders, and other documents",
      ],
      typicalOutputs: ["A solution design document", "A confirmed role and approval-threshold plan"],
    },
    {
      id: "configuration",
      name: "Configuration",
      description:
        "Organisation bootstrap is a real, one-transaction operation that seeds roughly 12 system roles and 29 numbering series at signup — configuration builds on that seeded foundation rather than starting from nothing, adapting it to the solution design rather than leaving defaults in place.",
      activities: [
        "Configure companies, branches, and departments per the solution design",
        "Adjust roles, permission packages, and any custom roles the design called for",
        "Set approval thresholds, matching tolerances, and other governance rules module by module",
        "Configure the chart of accounts, tax rules, and localisation settings (India-default: en-IN, Asia/Kolkata, INR, April-start fiscal year, adjustable per organisation)",
      ],
      typicalOutputs: ["A configured, entitlement-gated workspace matching the solution design"],
    },
    {
      id: "data-migration",
      name: "Data Migration",
      description:
        "Customers, items, suppliers, and open transactions are migrated and reconciled as part of implementation — a real service commitment, not an automated one-click import. This phase gets the expanded treatment because it's the step most implementation-risk objections are really about.",
      activities: [
        "Extract master data from current systems — items, parties (customers/suppliers), addresses, unit-of-measure, bills of material",
        "Cleanse and deduplicate before import — a spreadsheet's drift (duplicate customers, inconsistent item codes) doesn't get carried into the new system as-is",
        "Migrate open transactions (open sales orders, open purchase orders, outstanding invoices/bills) so operations don't have a gap at go-live",
        "Reconcile migrated data against source-system totals before sign-off — balances, quantities, and outstanding amounts are checked, not assumed correct",
      ],
      typicalOutputs: ["A reconciled master-data set", "A migrated, verified opening-balance position"],
      migrationChecklist: [
        "Item master (codes, pricing, unit-of-measure, BOM structures where applicable)",
        "Customer and supplier master data, including addresses and payment terms",
        "Opening stock balances by warehouse",
        "Open sales orders, purchase orders, and outstanding receivables/payables",
        "Chart of accounts and opening trial balance",
      ],
    },
    {
      id: "testing",
      name: "Testing",
      description:
        "Configured workflows are validated against real scenarios drawn from discovery — not a generic test script — before anyone depends on the system for a live transaction.",
      activities: [
        "Run real workflow scenarios end to end (e.g. a real quotation through to invoice, a real purchase order through to matched vendor bill)",
        "Validate approval routing and self-approval blocking behave as designed",
        "User acceptance testing with the actual people who will use the system day to day, not just IT",
      ],
      typicalOutputs: ["A validated set of real-scenario test results", "Sign-off from the people who'll actually use the system"],
    },
    {
      id: "training",
      name: "Training",
      description:
        "Role-based training matches the real role and permission design from solution design — a warehouse clerk isn't trained on the same screens as a finance controller.",
      activities: [
        "Role-based training sessions matching each real permission package",
        "Hands-on practice in a real, isolated workspace before go-live",
        "Documentation and reference material specific to the configured workflows, not generic product documentation",
      ],
      typicalOutputs: ["Trained users per role", "Role-specific reference documentation"],
    },
    {
      id: "launch",
      name: "Launch",
      description:
        "Go-live activates the subscription (through the platform's HMAC-verified, replay-protected billing webhook pipeline) and switches entitlement gates on for the configured module set.",
      activities: [
        "Final reconciliation check on migrated data",
        "Subscription activation and module entitlement confirmation",
        "Go-live cutover, with the prior system typically kept read-only for a reconciliation window rather than switched off immediately",
      ],
      typicalOutputs: ["A live, entitled workspace running real transactions"],
    },
    {
      id: "post-launch",
      name: "Post-Launch",
      description:
        "Early usage surfaces configuration refinements discovery couldn't fully anticipate — approval thresholds that turn out too tight or too loose, a report a team actually needs that wasn't scoped, a role that needs narrower access than first designed.",
      activities: [
        "Hypercare support during the initial usage period",
        "Configuration refinement based on real usage patterns",
        "Adoption review against the reporting and dashboards each role actually uses",
      ],
      typicalOutputs: ["A refined, stable configuration reflecting real usage"],
    },
  ],
  faqs: [
    { question: "How long does implementation actually take?", answer: "This varies by scope — module count, data volume, and process complexity all matter, and no two implementations look the same. Rather than quote a generic number, the discovery phase is specifically where a realistic scope and plan get set for your actual organisation." },
    { question: "What if our processes don't match a standard module exactly?", answer: "Configuration adapts numbering, roles, approval thresholds, and workflow governance to your real process — see the Configuration phase above for what's actually adjustable. Discovery and Solution Design exist specifically to catch process mismatches before configuration starts, not after." },
    { question: "Will we lose data or have a gap in operations during migration?", answer: "Open transactions — open sales orders, open purchase orders, outstanding receivables and payables — are migrated alongside master data, and migrated data is reconciled against source-system totals before sign-off. The typical pattern is keeping the prior system read-only for a reconciliation window rather than an abrupt cutover." },
    { question: "Do we need an in-house IT team to manage this?", answer: "An IT/Ops resource is useful for data extraction and integration questions during discovery and migration, but implementation doesn't require a dedicated in-house administrator to run day to day — the role and permission model is designed during solution design specifically so business owners of each module can operate it themselves." },
  ],
  conversion: { heading: "Talk through your real implementation scope.", ctaLabel: "Book a Demo" },
});
