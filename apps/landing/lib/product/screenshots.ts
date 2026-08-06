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
 * Captured 2026-08-06 from a synthetic demo organization ("Vercent Demo
 * Manufacturing") seeded in a local instance of the real apps/web product —
 * never from the pre-existing real organization. See
 * docs/landing-redesign/phase-3/screenshot-capture-process.md for the full
 * process and docs/landing-redesign/phase-3/product-evidence-register.md for
 * per-screenshot evidence tracing. A 6th capture (opportunity detail) was
 * deliberately excluded here: it renders raw internal UUIDs (company/branch/
 * stage/lead/party/contact/owner IDs) that read as an unfinished debug view,
 * not something an enterprise buyer should see on a marketing page.
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
]);

export function getApprovedScreenshot(id: string): ProductScreenshot | null {
  const match = APPROVED_SCREENSHOTS.find((screenshot) => screenshot.id === id);
  return match && match.approvedForMarketing ? match : null;
}
