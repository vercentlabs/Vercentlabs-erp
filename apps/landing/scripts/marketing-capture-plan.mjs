/**
 * Marketing screenshot capture plan: which current ERP screen each
 * marketing screenshot comes from, and the visible text that proves the
 * screen loaded the expected evidence. capture-marketing-screenshots.mjs
 * fails on any entry whose route redirects, 404s, or never shows `ready`.
 *
 * Routes were verified against apps/web/src/app/(workspace) on 2026-10-02.
 * Screens were chosen so that every visible column and control belongs to an
 * approved launch capability; for example the leads list (lead score), the
 * quotation list (versions), and the inventory items/receipts lists (barcode,
 * batch and serial columns) were reviewed and left out.
 *
 * `clip` keeps only the data region of a screen whose page subtitle describes
 * features outside the approved scope (the image is cropped, never edited).
 *
 * Capturing is not approval: lib/product/screenshots.ts approves an image
 * only after it has been inspected.
 */
export const CAPTURE_VIEWPORT = Object.freeze({ width: 1440, height: 900 });

export const MARKETING_CAPTURE_PLAN = Object.freeze([
  { id: "crm-opportunity-pipeline", module: "crm", route: "/crm/opportunities?view=pipeline", ready: "Negotiation", evidence: "Opportunities grouped by sales stage with value and probability" },
  { id: "sales-order-list", module: "sales", route: "/sales/orders", clip: { x: 64, y: 140, width: 1376, height: 290 }, clipReason: "subtitle lists credit checks, holds and amendments", ready: "SO-00001", evidence: "Sales orders with status, fulfilment and billing state" },
  { id: "inventory-stock-valuation", module: "stock", route: "/inventory/valuation", ready: "Total stock value", evidence: "Stock on hand and value by item and warehouse" },
  { id: "accounting-customer-invoices", module: "accounting", route: "/accounting/customer-invoices", ready: "INV-00001", evidence: "Posted customer invoices with outstanding amounts" },
  { id: "accounting-trial-balance", module: "accounting", route: "/accounting/trial-balance", ready: "Trade receivables", evidence: "Trial balance of posted ledger accounts" },
  { id: "procurement-purchase-order-list", module: "procurement", route: "/procurement/orders", clip: { x: 64, y: 140, width: 1376, height: 290 }, clipReason: "subtitle lists PO amendments", ready: "PO-000001", evidence: "Purchase orders by supplier with dispatch and receipt status" },
  { id: "manufacturing-production-orders", module: "manufacturing", route: "/manufacturing/production-orders", ready: "WO-000001", evidence: "Production orders with planned and released status" },
  { id: "projects-portfolio", module: "projects", route: "/projects/all", clip: { x: 64, y: 158, width: 1376, height: 390 }, clipReason: "subtitle describes a project approval workflow", ready: "PRJ-000001", evidence: "Customer projects with manager, planned end, health and status" },
  { id: "support-ticket-list", module: "support", route: "/support/tickets", ready: "TKT-000001", evidence: "Customer tickets with priority, status and owner" },
  { id: "quality-inspection-list", module: "quality", route: "/quality/inspections", ready: "QI-000001", evidence: "Incoming inspections with lot size and pass/fail result" },
  { id: "hr-employee-directory", module: "hr-payroll", route: "/hr/employees", clip: { x: 64, y: 337, width: 1376, height: 370 }, clipReason: "subtitle and summary cards mention probation, onboarding and notice periods", ready: "EMP-00001", evidence: "Employee directory with department, type and joining date" },
]);
