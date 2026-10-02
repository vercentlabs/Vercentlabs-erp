/**
 * Buyer-role perspectives woven into industry and workflow pages (via the
 * shared RolePerspective component), not built as standalone pages.
 *
 * Grounded in each ICP's buying committee (Owner/MD, Plant/Operations Head,
 * Finance Head/CFO for Manufacturing; Owner/Operations Director, Purchasing
 * Manager for Distribution/Retail; Managing Partner, Project/Delivery Heads,
 * Finance, HR for Professional Services) — every `proofPoint` traces to a
 * real, cited capability, not invented.
 */
export const BUYER_ROLES = Object.freeze([
  {
    slug: "ceo-owner",
    title: "CEO / Owner",
    concernSummary: "Margin, control, and whether the business can grow without the wheels coming off.",
    primaryConcerns: [
      "One set of numbers for sales, stock, and the books",
      "Whether the team will actually adopt a new system",
      "Control across companies and branches without handing out all-or-nothing access",
    ],
    relevantModuleKeys: ["accounting", "manufacturing", "projects"],
    proofPoint: "Roles, permissions, and company and branch access let an owner give each person access to the companies, branches, and records they need — without handing out all-or-nothing admin rights.",
  },
  {
    slug: "coo",
    title: "COO / Operations Director",
    concernSummary: "Whether operations run on the same numbers finance and the shop floor see, in real time.",
    primaryConcerns: [
      "One stock number across every location, not a reconciled-at-month-end estimate",
      "Procurement and production actually staying synchronised",
      "Stock reservations and quality holds that keep promises reliable",
    ],
    relevantModuleKeys: ["stock", "procurement", "manufacturing"],
    proofPoint: "Goods receipts, sales orders, Manufacturing, and Point of Sale all work on the same real-time stock ledger — not a nightly batch sync between separate systems.",
  },
  {
    slug: "cfo",
    title: "CFO / Finance Head",
    concernSummary: "Costing accuracy, an audit trail that holds up, and a close that doesn't depend on tribal knowledge.",
    primaryConcerns: [
      "Production costing and inventory valuation from real movements",
      "Fiscal years, accounting periods, and double-entry enforcement on every journal",
      "An audit trail no one — including an app bug — can quietly alter",
    ],
    relevantModuleKeys: ["accounting", "procurement", "projects"],
    proofPoint: "The platform audit log is protected at the database level — a trigger rejects any attempt to update or delete an entry, even from inside the application.",
  },
  {
    slug: "sales-leader",
    title: "Sales Leader",
    concernSummary: "Whether the pipeline reflects real qualification, and whether quotes convert without friction.",
    primaryConcerns: [
      "A pipeline built on real qualification stages, not optimism",
      "Quotations created straight from the opportunity, without re-typing",
      "Stock availability checked before an order is confirmed, not after",
    ],
    relevantModuleKeys: ["crm", "sales"],
    proofPoint: "An opportunity converts into a Sales quotation, and the resulting sales order checks availability and reserves stock before it's confirmed.",
  },
  {
    slug: "plant-manager",
    title: "Plant / Operations Manager",
    concernSummary: "Whether the shop floor can actually run on the system, day to day, without a paper backup.",
    primaryConcerns: [
      "Manufacturing orders checked for material availability before production starts",
      "Quality holds that actually stop bad material from moving, not a note in a spreadsheet",
      "Usability the shop floor will adopt, not just the planning office",
    ],
    relevantModuleKeys: ["manufacturing", "quality", "stock"],
    proofPoint: "Each manufacturing order checks material availability against its bill of materials, and every material issue and finished-goods receipt posts to the same stock ledger.",
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
    proofPoint: "An approver can't approve a payroll that includes their own pay, and nobody can decide their own leave request — enforced by the system, not left to policy.",
  },
]);

export function getBuyerRole(slug) {
  return BUYER_ROLES.find((role) => role.slug === slug) || null;
}

export function getBuyerRolesBySlugs(slugs) {
  return slugs.map((slug) => getBuyerRole(slug)).filter(Boolean);
}
