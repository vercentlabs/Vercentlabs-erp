export interface ProductScreenshot {
  id: string;
  src: string;
  alt: string;
  width: number;
  height: number;
  module: string;
  /** Routed workflows whose steps this screen evidences (used to pick evidence on workflow pages). */
  workflows?: readonly string[];
  caption?: string;
  /**
   * ISO date the image was captured. Required before approval: only captures of
   * the current ERP UI (rebuilt 2026-09-14) can be approved — see
   * tests/homepage.test.mjs.
   */
  capturedAt?: string;
  /** Only screenshots with this set to true may render on an indexable page. */
  approvedForMarketing: boolean;
  /** A capture of the replaced pre-2026-09-14 ERP UI. Kept for history; can never be approved. */
  retired?: boolean;
}

/**
 * Screenshot registry. Pages render a screenshot only through
 * getApprovedScreenshot() and the helpers below, which return nothing for an
 * entry that is not approved for marketing; callers then show a truthful
 * diagram instead (components/product/product-evidence.tsx).
 *
 * Current captures (2026-10-02) come from the current ERP UI: a production
 * build in the ERP's local profile, signed in to the synthetic "Northstar Demo
 * Company" seeded by scripts/qa/seed-marketing-demo-org.mjs, captured by
 * apps/landing/scripts/capture-marketing-screenshots.mjs. Each was inspected
 * before approval: every visible name is synthetic, there is no development
 * indicator, and every visible column and control belongs to an approved
 * launch capability. Four are cropped to their data region because the page
 * subtitle describes features outside the approved scope (see
 * scripts/marketing-capture-plan.mjs).
 *
 * The 14 retired entries were captured on 2026-08-06/07 from the ERP UI that
 * was replaced on 2026-09-14 (with out-of-scope navigation and the Next.js
 * development indicator). They stay registered for history, unapproved, and
 * tests refuse to let them be approved again.
 */
const APPROVED_SCREENSHOTS: readonly ProductScreenshot[] = Object.freeze([
  // ---- Current ERP UI, synthetic demo data, inspected and approved 2026-10-02.
  {
    id: "crm-opportunity-pipeline",
    src: "/product/crm-opportunity-pipeline.png",
    alt: "Vercentlabs ERP CRM pipeline board with opportunities grouped by sales stage (Qualification, Needs Analysis, Proposal and Negotiation), each card showing the account, value, probability, owner and expected close date.",
    width: 1440,
    height: 900,
    module: "crm",
    workflows: ["lead-to-cash"],
    caption: "CRM pipeline: open opportunities by sales stage, with value and probability.",
    capturedAt: "2026-10-02",
    approvedForMarketing: true,
  },
  {
    id: "sales-order-list",
    src: "/product/sales-order-list.png",
    alt: "Vercentlabs ERP sales order list showing confirmed and draft orders with customer, fulfilment status, billing status and order total.",
    width: 1376,
    height: 290,
    module: "sales",
    workflows: ["lead-to-cash", "order-to-fulfilment"],
    caption: "Sales orders: confirmation, fulfilment and billing state for each customer order.",
    capturedAt: "2026-10-02",
    approvedForMarketing: true,
  },
  {
    id: "inventory-stock-valuation",
    src: "/product/inventory-stock-valuation.png",
    alt: "Vercentlabs ERP inventory valuation showing total stock value and units on hand, with on-hand quantity, unit value and stock value for each item in the main warehouse.",
    width: 1440,
    height: 900,
    module: "stock",
    workflows: ["order-to-fulfilment", "procure-to-pay"],
    caption: "Inventory valuation: on-hand quantity and value by item and warehouse.",
    capturedAt: "2026-10-02",
    approvedForMarketing: true,
  },
  {
    id: "accounting-customer-invoices",
    src: "/product/accounting-customer-invoices.png",
    alt: "Vercentlabs ERP customer invoice list showing posted invoices with customer, due date, total and outstanding amount, and the total receivable outstanding.",
    width: 1440,
    height: 900,
    module: "accounting",
    workflows: ["lead-to-cash"],
    caption: "Customer invoices: posted receivables with the amount still outstanding.",
    capturedAt: "2026-10-02",
    approvedForMarketing: true,
  },
  {
    id: "accounting-trial-balance",
    src: "/product/accounting-trial-balance.png",
    alt: "Vercentlabs ERP trial balance listing ledger accounts (main bank, trade receivables and sales revenue) with debit, credit and balance columns.",
    width: 1440,
    height: 900,
    module: "accounting",
    caption: "Trial balance: debits, credits and balance for every posted account.",
    capturedAt: "2026-10-02",
    approvedForMarketing: true,
  },
  {
    id: "procurement-purchase-order-list",
    src: "/product/procurement-purchase-order-list.png",
    alt: "Vercentlabs ERP purchase order list showing orders to suppliers with title, status (dispatched or received), expected date and total.",
    width: 1376,
    height: 290,
    module: "procurement",
    workflows: ["procure-to-pay"],
    caption: "Purchase orders: what was ordered from each supplier, and whether it has been received.",
    capturedAt: "2026-10-02",
    approvedForMarketing: true,
  },
  {
    id: "manufacturing-production-orders",
    src: "/product/manufacturing-production-orders.png",
    alt: "Vercentlabs ERP production order list showing planned and released orders for a finished product, with quantity done against planned.",
    width: 1440,
    height: 900,
    module: "manufacturing",
    workflows: ["plan-to-production"],
    caption: "Production orders: what is being made, how much, and where each order stands.",
    capturedAt: "2026-10-02",
    approvedForMarketing: true,
  },
  {
    id: "projects-portfolio",
    src: "/product/projects-portfolio.png",
    alt: "Vercentlabs ERP project list showing two active customer projects with manager, progress, planned end date, health and status.",
    width: 1376,
    height: 390,
    module: "projects",
    workflows: ["project-to-profitability"],
    caption: "Projects: active customer projects with progress and status.",
    capturedAt: "2026-10-02",
    approvedForMarketing: true,
  },
  {
    id: "support-ticket-list",
    src: "/product/support-ticket-list.png",
    alt: "Vercentlabs ERP support ticket list showing tickets with subject, customer, priority, status (new, open or resolved) and creation time.",
    width: 1440,
    height: 900,
    module: "support",
    caption: "Support tickets: each one logged against a customer, with priority and status.",
    capturedAt: "2026-10-02",
    approvedForMarketing: true,
  },
  {
    id: "quality-inspection-list",
    src: "/product/quality-inspection-list.png",
    alt: "Vercentlabs ERP inspection list showing incoming inspections against a plan, with lot and sample size and a passed, failed or in-progress result.",
    width: 1440,
    height: 900,
    module: "quality",
    caption: "Quality inspections: incoming lots inspected against a plan, with pass or fail results.",
    capturedAt: "2026-10-02",
    approvedForMarketing: true,
  },
  {
    id: "hr-employee-directory",
    src: "/product/hr-employee-directory.png",
    alt: "Vercentlabs ERP employee list showing employee number, name, status, employment type, department and joining date.",
    width: 1376,
    height: 370,
    module: "hr-payroll",
    workflows: ["hire-to-payroll"],
    caption: "Employees: the employee master by department, type and joining date.",
    capturedAt: "2026-10-02",
    approvedForMarketing: true,
  },
  // ---- Retired: the replaced ERP UI. Never approve these again.
  {
    id: "crm-pipeline-board",
    src: "/product/crm-pipeline-board.png",
    alt: "CRM opportunity pipeline board showing deals grouped by stage — Qualification, Needs analysis, Value proposition, Proposal, Negotiation, Closed won — with stage probability and value totals for each column.",
    width: 1920,
    height: 1000,
    module: "crm",
    workflows: ["lead-to-cash"],
    caption: "Opportunity pipeline — stage-governed, with probability and forecast value synced automatically.",
    approvedForMarketing: false,
    retired: true,
  },
  {
    id: "crm-leads-list",
    src: "/product/crm-leads-list.png",
    alt: "CRM leads list showing six leads with company, status, score, and value columns, and status values from New through Qualified and Converted.",
    width: 1440,
    height: 1160,
    module: "crm",
    workflows: ["lead-to-cash"],
    caption: "Every inbound lead — captured, scored, and tracked through conversion.",
    approvedForMarketing: false,
    retired: true,
  },
  {
    id: "sales-quotation-detail",
    src: "/product/sales-quotation-detail.png",
    alt: "Sales quotation detail page showing commercial line items, totals, an immutable revision history, and a full document audit trail from created through sent, viewed, accepted, and converted.",
    width: 1440,
    height: 1080,
    module: "sales",
    workflows: ["lead-to-cash"],
    caption: "Quotations carry an immutable audit trail — every state change timestamped, nothing overwritten.",
    approvedForMarketing: false,
    retired: true,
  },
  {
    id: "sales-order-detail",
    src: "/product/sales-order-detail.png",
    alt: "Sales order detail page showing document governance status for readiness, fulfilment, invoicing and closure, order lines with a quantity lifecycle from ordered through confirmed, fulfilled, invoiced, and remaining.",
    width: 1440,
    height: 1080,
    module: "sales",
    workflows: ["lead-to-cash"],
    caption: "Sales orders track full quantity lifecycle and governance state — nothing ships or bills without the gate clearing.",
    approvedForMarketing: false,
    retired: true,
  },
  {
    id: "stock-overview",
    src: "/product/stock-overview.png",
    alt: "Stock overview page showing on-hand quantity, reserved quantity, inventory value, and low-stock count for a warehouse.",
    width: 1440,
    height: 900,
    module: "stock",
    caption: "Real-time on-hand, reserved, and valuation — no end-of-day reconciliation required.",
    approvedForMarketing: false,
    retired: true,
  },
  {
    id: "accounting-dashboard",
    src: "/product/accounting-dashboard.png",
    alt: "Accounting operations workspace showing accounts receivable, accounts payable, net working position, and fixed asset book value, plus a six-step capture-approve-post-reconcile-close-report workflow.",
    width: 1440,
    height: 900,
    module: "accounting",
    caption: "One financial workspace for capture, approval, posting, reconciliation, close, and reporting.",
    approvedForMarketing: false,
    retired: true,
  },
  {
    id: "procurement-orders-list",
    src: "/product/procurement-orders-list.png",
    alt: "Procurement purchase orders list showing a governed purchase order with title, version number, and an Acknowledged lifecycle status badge.",
    width: 1440,
    height: 900,
    module: "procurement",
    workflows: ["procure-to-pay"],
    caption: "Every purchase order carries a governed lifecycle — submitted, approved, dispatched, acknowledged.",
    approvedForMarketing: false,
    retired: true,
  },
  {
    id: "manufacturing-dashboard",
    src: "/product/manufacturing-dashboard.png",
    alt: "Manufacturing production control workspace showing active, planned, and completed work order counts, material shortages, and bill-of-material and work-order workflow sections.",
    width: 1440,
    height: 900,
    module: "manufacturing",
    workflows: ["plan-to-production"],
    caption: "Work orders planned against real bills of material, with material shortages visible before release.",
    approvedForMarketing: false,
    retired: true,
  },
  {
    id: "projects-dashboard",
    src: "/product/projects-dashboard.png",
    alt: "Projects delivery and profitability control workspace showing active project, overdue project, overdue task, and contracted revenue counts.",
    width: 1440,
    height: 900,
    module: "projects",
    workflows: ["project-to-profitability"],
    caption: "Milestones, tasks, time, and contracted revenue in one delivery and profitability view.",
    approvedForMarketing: false,
    retired: true,
  },
  {
    id: "assets-dashboard",
    src: "/product/assets-dashboard.png",
    alt: "Assets lifecycle and maintenance control workspace showing total assets, assigned assets, in-maintenance count, maintenance due, and net book value.",
    width: 1440,
    height: 900,
    module: "assets",
    caption: "Asset acquisition, custody, maintenance, and depreciation tracked from one lifecycle register.",
    approvedForMarketing: false,
    retired: true,
  },
  {
    id: "quality-dashboard",
    src: "/product/quality-dashboard.png",
    alt: "Quality inspection and corrective-action control workspace showing open inspection, failed inspection, active hold, open non-conformance, and open CAPA counts, plus quality-plan and inspection workflow sections.",
    width: 1440,
    height: 900,
    module: "quality",
    caption: "Inspection plans, holds, non-conformance, and CAPA governed from one quality workspace.",
    approvedForMarketing: false,
    retired: true,
  },
  {
    id: "support-dashboard",
    src: "/product/support-dashboard.png",
    alt: "Support customer service operations workspace showing open ticket, high-priority, first-response-breach, resolution-breach, and open-escalation counts.",
    width: 1440,
    height: 900,
    module: "support",
    caption: "Tickets, SLA targets, escalations, and communication history in one customer-service workspace.",
    approvedForMarketing: false,
    retired: true,
  },
  {
    id: "hr-payroll-dashboard",
    src: "/product/hr-payroll-dashboard.png",
    alt: "HR and Payroll workforce and payroll control workspace showing active employee, employees-on-leave, new-joiner, open-payroll-run, and latest-net-pay counts.",
    width: 1440,
    height: 900,
    module: "hr-payroll",
    workflows: ["hire-to-payroll"],
    caption: "Employees, attendance, leave, and payroll runs connected in one workforce workspace.",
    approvedForMarketing: false,
    retired: true,
  },
  {
    id: "point-of-sale-dashboard",
    src: "/product/point-of-sale-dashboard.png",
    alt: "Point of Sale retail checkout and shift control workspace showing sales today, revenue today, open shifts, and returns today counts.",
    width: 1440,
    height: 900,
    module: "point-of-sale",
    workflows: ["retail-checkout-to-inventory"],
    caption: "Checkout, shifts, and cash reconciliation kept in step with Stock and Accounting evidence.",
    approvedForMarketing: false,
    retired: true,
  },
]);

export function getApprovedScreenshot(id: string): ProductScreenshot | null {
  const match = APPROVED_SCREENSHOTS.find((screenshot) => screenshot.id === id);
  return match && match.approvedForMarketing && !match.retired ? match : null;
}

/** Approved screenshots that evidence a routed workflow, in registry order. */
export function getApprovedScreenshotsForWorkflow(slug: string): ProductScreenshot[] {
  return APPROVED_SCREENSHOTS.filter((screenshot) => screenshot.approvedForMarketing && !screenshot.retired && Boolean(screenshot.workflows?.includes(slug)));
}
