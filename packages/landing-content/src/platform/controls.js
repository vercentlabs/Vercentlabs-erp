import { CTAS } from "../navigation.js";

/**
 * /product/automation ("Built-In Controls") — rules the system enforces inside the work of each module. The export keeps its original name for API stability.
 * Product statements must stay inside the approved launch capability register
 * (capabilities/launch-capabilities.js).
 */
export const AUTOMATION_PAGE = Object.freeze({
  slug: "/product/automation",
  title: "Workflow Automation",
  metaDescription:
    "The controls Vercentlabs ERP enforces inside everyday work — duplicate detection, stock reservation, negative-stock control, quality holds, invoice matching, and leave and payroll approval.",
  directDefinition:
    "Workflow automation in Vercentlabs ERP means rules the system enforces inside each module's own work — duplicate detection, stock reservation and negative-stock control, quality holds, 2-way and 3-way invoice matching, and leave and payroll approval — rather than a separate, general-purpose workflow builder.",
  eyebrow: "Workflow automation",
  heading: "Rules enforced by the system, inside the work.",
  supportingText:
    "Each item below is a control built into an approved launch capability. Vercentlabs ERP does not include a general-purpose workflow or approval builder at launch.",
  sections: [
    {
      id: "event-triggered-actions",
      heading: "Checks when records are created",
      items: [
        { title: "Duplicate detection", description: "Likely duplicate leads, accounts, and contacts are flagged before a second record is created." },
        { title: "Document numbering", description: "Tickets, orders, and other documents get their numbers from the configured numbering series." },
      ],
    },
    {
      id: "stock-controls",
      heading: "Stock controls",
      items: [
        { title: "Availability and reservation", description: "Sales orders check stock availability and reserve it for confirmed orders." },
        { title: "Negative-stock control", description: "Issues that would take stock below zero are blocked unless the business explicitly allows it." },
        { title: "Quality holds", description: "Stock under a quality hold can't be moved until the hold is released." },
      ],
    },
    {
      id: "approval-chains",
      heading: "Approvals",
      items: [
        { title: "Leave approval", description: "Leave requests are approved in the system, and approved leave updates the employee's leave balance." },
        { title: "Payroll approval", description: "Payroll is approved before payslips are issued — and an approver can't approve a payroll that includes their own pay." },
      ],
    },
    {
      id: "cross-module-automation",
      heading: "Cross-module checks",
      items: [
        { title: "Invoice matching", description: "Supplier invoices are matched 2-way against the purchase order, or 3-way against the order and goods receipt." },
        { title: "Stock postings from operations", description: "Goods receipts, Manufacturing material issues and finished-goods receipts, and Point of Sale sales post to the same stock ledger." },
        { title: "Double-entry enforcement", description: "Every journal must balance before it posts to the general ledger." },
      ],
    },
  ],
  connectedModuleKeys: ["crm", "sales", "stock", "procurement", "quality", "hr-payroll"],
  primaryCta: CTAS.talkToSpecialist,
  finalCtaHeading: "Walk through these controls with an ERP specialist.",
});
