export interface ProductScreenshot {
  id: string;
  src: string;
  alt: string;
  width: number;
  height: number;
  module: string;
  workflow?: string;
  caption?: string;
  /** Only screenshots with this set to true may render on an indexable page. */
  approvedForMarketing: boolean;
}

/**
 * The first 5 captures (crm-*, sales-*, stock-overview) were captured
 * 2026-08-06; the 9 that follow (accounting through point-of-sale) were
 * captured 2026-08-07 in Phase 5, closing the module-evidence gap
 * `docs/landing-redesign/phase-4/screenshot-extension-register.md`
 * documented. All from a synthetic demo organization ("Vercent Demo
 * Manufacturing") seeded in a local instance of the real apps/web product —
 * never from the pre-existing real organization. See
 * docs/landing-redesign/phase-3/screenshot-capture-process.md for the full
 * process and docs/landing-redesign/phase-5/product-evidence-update.md for
 * per-screenshot evidence tracing. Two captures were deliberately excluded
 * for rendering raw internal UUIDs unstyled (an opportunity-detail capture
 * in Phase 3, a purchase-order-detail capture in Phase 5) — neither reads
 * as a screen an enterprise buyer should see on a marketing page.
 */
export const APPROVED_SCREENSHOTS: readonly ProductScreenshot[] = Object.freeze([
  {
    id: "crm-pipeline-board",
    src: "/product/crm-pipeline-board.png",
    alt: "CRM opportunity pipeline board showing deals grouped by stage — Qualification, Needs analysis, Value proposition, Proposal, Negotiation, Closed won — with stage probability and value totals for each column.",
    width: 1920,
    height: 1000,
    module: "crm",
    workflow: "lead-to-cash",
    caption: "Opportunity pipeline — stage-governed, with probability and forecast value synced automatically.",
    approvedForMarketing: true,
  },
  {
    id: "crm-leads-list",
    src: "/product/crm-leads-list.png",
    alt: "CRM leads list showing six leads with company, status, score, and value columns, and status values from New through Qualified and Converted.",
    width: 1440,
    height: 1160,
    module: "crm",
    workflow: "lead-to-cash",
    caption: "Every inbound lead — captured, scored, and tracked through conversion.",
    approvedForMarketing: true,
  },
  {
    id: "sales-quotation-detail",
    src: "/product/sales-quotation-detail.png",
    alt: "Sales quotation detail page showing commercial line items, totals, an immutable revision history, and a full document audit trail from created through sent, viewed, accepted, and converted.",
    width: 1440,
    height: 1364,
    module: "sales",
    workflow: "lead-to-cash",
    caption: "Quotations carry an immutable audit trail — every state change timestamped, nothing overwritten.",
    approvedForMarketing: true,
  },
  {
    id: "sales-order-detail",
    src: "/product/sales-order-detail.png",
    alt: "Sales order detail page showing document governance status for readiness, fulfilment, invoicing and closure, order lines with a quantity lifecycle from ordered through confirmed, fulfilled, invoiced, and remaining.",
    width: 1440,
    height: 1290,
    module: "sales",
    workflow: "lead-to-cash",
    caption: "Sales orders track full quantity lifecycle and governance state — nothing ships or bills without the gate clearing.",
    approvedForMarketing: true,
  },
  {
    id: "stock-overview",
    src: "/product/stock-overview.png",
    alt: "Stock overview page showing on-hand quantity, reserved quantity, inventory value, and low-stock count for a warehouse.",
    width: 1440,
    height: 900,
    module: "stock",
    caption: "Real-time on-hand, reserved, and valuation — no end-of-day reconciliation required.",
    approvedForMarketing: true,
  },
  {
    id: "accounting-dashboard",
    src: "/product/accounting-dashboard.png",
    alt: "Accounting operations workspace showing accounts receivable, accounts payable, net working position, and fixed asset book value, plus a six-step capture-approve-post-reconcile-close-report workflow.",
    width: 1440,
    height: 900,
    module: "accounting",
    caption: "One financial workspace for capture, approval, posting, reconciliation, close, and reporting.",
    approvedForMarketing: true,
  },
  {
    id: "procurement-orders-list",
    src: "/product/procurement-orders-list.png",
    alt: "Procurement purchase orders list showing a governed purchase order with title, version number, and an Acknowledged lifecycle status badge.",
    width: 1440,
    height: 900,
    module: "procurement",
    workflow: "procure-to-pay",
    caption: "Every purchase order carries a governed lifecycle — submitted, approved, dispatched, acknowledged.",
    approvedForMarketing: true,
  },
  {
    id: "manufacturing-dashboard",
    src: "/product/manufacturing-dashboard.png",
    alt: "Manufacturing production control workspace showing active, planned, and completed work order counts, material shortages, and bill-of-material and work-order workflow sections.",
    width: 1440,
    height: 900,
    module: "manufacturing",
    workflow: "plan-to-production",
    caption: "Work orders planned against real bills of material, with material shortages visible before release.",
    approvedForMarketing: true,
  },
  {
    id: "projects-dashboard",
    src: "/product/projects-dashboard.png",
    alt: "Projects delivery and profitability control workspace showing active project, overdue project, overdue task, and contracted revenue counts.",
    width: 1440,
    height: 900,
    module: "projects",
    workflow: "project-to-profitability",
    caption: "Milestones, tasks, time, and contracted revenue in one delivery and profitability view.",
    approvedForMarketing: true,
  },
  {
    id: "assets-dashboard",
    src: "/product/assets-dashboard.png",
    alt: "Assets lifecycle and maintenance control workspace showing total assets, assigned assets, in-maintenance count, maintenance due, and net book value.",
    width: 1440,
    height: 900,
    module: "assets",
    caption: "Asset acquisition, custody, maintenance, and depreciation tracked from one lifecycle register.",
    approvedForMarketing: true,
  },
  {
    id: "quality-dashboard",
    src: "/product/quality-dashboard.png",
    alt: "Quality inspection and corrective-action control workspace showing open inspection, failed inspection, active hold, open non-conformance, and open CAPA counts, plus quality-plan and inspection workflow sections.",
    width: 1440,
    height: 900,
    module: "quality",
    caption: "Inspection plans, holds, non-conformance, and CAPA governed from one quality workspace.",
    approvedForMarketing: true,
  },
  {
    id: "support-dashboard",
    src: "/product/support-dashboard.png",
    alt: "Support customer service operations workspace showing open ticket, high-priority, first-response-breach, resolution-breach, and open-escalation counts.",
    width: 1440,
    height: 900,
    module: "support",
    caption: "Tickets, SLA targets, escalations, and communication history in one customer-service workspace.",
    approvedForMarketing: true,
  },
  {
    id: "hr-payroll-dashboard",
    src: "/product/hr-payroll-dashboard.png",
    alt: "HR and Payroll workforce and payroll control workspace showing active employee, employees-on-leave, new-joiner, open-payroll-run, and latest-net-pay counts.",
    width: 1440,
    height: 900,
    module: "hr-payroll",
    workflow: "payroll-to-books",
    caption: "Employees, attendance, leave, and payroll runs connected in one workforce workspace.",
    approvedForMarketing: true,
  },
  {
    id: "point-of-sale-dashboard",
    src: "/product/point-of-sale-dashboard.png",
    alt: "Point of Sale retail checkout and shift control workspace showing sales today, revenue today, open shifts, and returns today counts.",
    width: 1440,
    height: 900,
    module: "point-of-sale",
    workflow: "retail-checkout-to-inventory",
    caption: "Checkout, shifts, and cash reconciliation kept in step with Stock and Accounting evidence.",
    approvedForMarketing: true,
  },
]);

export function getApprovedScreenshot(id: string): ProductScreenshot | null {
  const match = APPROVED_SCREENSHOTS.find((screenshot) => screenshot.id === id);
  return match && match.approvedForMarketing ? match : null;
}
