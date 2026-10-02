import { CTAS } from "../navigation.js";

/**
 * /product/analytics ("Reporting") — reports from the records every module works on. The export keeps its original name for API stability.
 * Product statements must stay inside the approved launch capability register
 * (capabilities/launch-capabilities.js).
 */
export const ANALYTICS_PAGE = Object.freeze({
  slug: "/product/analytics",
  title: "Reporting & Analytics",
  metaDescription:
    "Vercentlabs ERP reports come from the same records every module works on — financial statements from the general ledger, real-time stock balances, POS day-end reports, and searchable, filterable lists.",
  directDefinition:
    "Reporting in Vercentlabs ERP comes straight from the operational records each module works on — the trial balance, profit & loss, and balance sheet from the general ledger, stock balances and movement history from the stock ledger, and searchable, filterable, sortable lists across modules.",
  eyebrow: "Reporting & analytics",
  heading: "Reports from the same data your teams work in — not a separate copy.",
  supportingText:
    "The reports below are part of the approved launch modules. Lists can also be searched, filtered, sorted, and paged.",
  sections: [
    {
      id: "module-reports",
      heading: "Module reports",
      items: [
        { title: "Accounting", description: "Trial balance, profit & loss, and balance sheet from the double-entry general ledger." },
        { title: "Stock", description: "Real-time stock balances and the full inventory movement history." },
        { title: "Point of Sale", description: "The Day-End / Z report and payment reconciliation by payment method." },
        { title: "Sales and CRM", description: "Order status tracking, and the opportunity pipeline by sales stage." },
      ],
    },
    {
      id: "access-scoped",
      heading: "Scoped by role and access",
      items: [
        { title: "Same access rules everywhere", description: "Reports and lists respect the same roles, permissions, and company and branch access as the rest of the platform." },
      ],
    },
    {
      id: "exports-documents",
      heading: "Finding and exporting data",
      items: [
        { title: "Search, filtering, sorting, and pagination", description: "Lists across modules can be searched, filtered, sorted, and paged." },
        { title: "Export", description: "Data can be exported as CSV for use outside the system — available today for CRM leads." },
        { title: "PDF and print", description: "Business documents can be produced as PDFs and printed." },
      ],
    },
  ],
  connectedModuleKeys: ["accounting", "stock", "point-of-sale", "sales"],
  primaryCta: CTAS.talkToSpecialist,
  finalCtaHeading: "Walk through the reports with an ERP specialist.",
});
