/**
 * Buyer-role perspectives woven into industry and workflow pages (via the
 * shared RolePerspective component), not built as standalone pages — per
 * Phase 5's brief: "not necessarily new dedicated indexable pages."
 *
 * Grounded in docs/landing-redesign/phase-1/icp-and-buyer-map.md's buying
 * committees (Owner/MD, Plant/Operations Head, Finance Head/CFO for
 * Manufacturing; Owner/Operations Director, Purchasing Manager for
 * Distribution/Retail; Managing Partner, Project/Delivery Heads, Finance,
 * HR for Professional Services) and docs/landing-redesign/phase-1/
 * product-intelligence.md's per-module "Best marketing angle" lines —
 * every `proofPoint` traces to a real, cited capability, not invented.
 */
export const BUYER_ROLES = Object.freeze([
  {
    slug: "ceo-owner",
    title: "CEO / Owner",
    concernSummary: "Margin, control, and whether the business can grow without the wheels coming off.",
    primaryConcerns: [
      "Real margin visibility, not a month-end guess",
      "Whether the team will actually adopt a new system",
      "Control across companies and branches without micromanaging every approval",
    ],
    relevantModuleKeys: ["accounting", "manufacturing", "projects"],
    proofPoint: "Time-bound, scoped role assignments mean an owner can grant real access — to a specific company, branch, or department — without handing out all-or-nothing admin rights.",
  },
  {
    slug: "coo",
    title: "COO / Operations Director",
    concernSummary: "Whether operations run on the same numbers finance and the shop floor see, in real time.",
    primaryConcerns: [
      "One stock number across every location, not a reconciled-at-month-end estimate",
      "Procurement and production actually staying synchronised",
      "Governed approvals that don't slow the business down",
    ],
    relevantModuleKeys: ["stock", "procurement", "manufacturing"],
    proofPoint: "Manufacturing and Point of Sale both post real, race-safe stock movements into the same ledger in the same database transaction as the underlying event — not a nightly batch sync.",
  },
  {
    slug: "cfo",
    title: "CFO / Finance Head",
    concernSummary: "Costing accuracy, an audit trail that holds up, and a close that doesn't depend on tribal knowledge.",
    primaryConcerns: [
      "Real-time costing instead of a month-end guess",
      "A close process that mechanically blocks completion until exceptions are resolved",
      "An audit trail no one — including an app bug — can quietly alter",
    ],
    relevantModuleKeys: ["accounting", "procurement", "projects"],
    proofPoint: "Every audit log entry is immutable at the database level — a Postgres trigger rejects UPDATE and DELETE even against application bugs, not just a UI restriction.",
  },
  {
    slug: "sales-leader",
    title: "Sales Leader",
    concernSummary: "Whether the pipeline reflects real qualification, and whether quotes convert without friction.",
    primaryConcerns: [
      "A forecast built on evidence, not optimism",
      "Fast, self-service quote acceptance that doesn't stall a deal",
      "Real-time credit visibility before a deal is confirmed, not after",
    ],
    relevantModuleKeys: ["crm", "sales"],
    proofPoint: "A quotation can be accepted or rejected by the customer via a public, single-use, hashed share link with a typed digital signature — no login required, no separate portal to build.",
  },
  {
    slug: "plant-manager",
    title: "Plant / Operations Manager",
    concernSummary: "Whether the shop floor can actually run on the system, day to day, without a paper backup.",
    primaryConcerns: [
      "Work orders that can't be released without proven material availability",
      "Quality holds that actually stop bad material from moving, not a note in a spreadsheet",
      "Usability the shop floor will adopt, not just the planning office",
    ],
    relevantModuleKeys: ["manufacturing", "quality", "stock"],
    proofPoint: "A released work order cannot proceed without proven component availability, and every material issue and finished-goods receipt posts as a real, auditable stock movement in the same transaction.",
  },
  {
    slug: "hr-leader",
    title: "HR Leader",
    concernSummary: "Whether payroll can be defended in an audit, and whether HR data still lives in a spreadsheet.",
    primaryConcerns: [
      "Attendance-driven pay calculation instead of manual reconciliation",
      "Maker-checker controls on payroll and leave, not one person doing both",
      "A single employee record instead of parallel HR and payroll spreadsheets",
    ],
    relevantModuleKeys: ["hr-payroll"],
    proofPoint: "Payroll runs require a different approver than the preparer, and leave requests cannot be approved by the person who submitted them — enforced in the code, not left to policy.",
  },
]);

export function getBuyerRole(slug) {
  return BUYER_ROLES.find((role) => role.slug === slug) || null;
}

export function getBuyerRolesBySlugs(slugs) {
  return slugs.map((slug) => getBuyerRole(slug)).filter(Boolean);
}
