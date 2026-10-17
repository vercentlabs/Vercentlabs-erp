/**
 * AEO answer library — reusable, typed Q&A entries that power visible
 * content across pages (glossary cards, resource intros, FAQ sections).
 * This is not a hidden database and not a dedicated page per question —
 * each entry's directAnswer/expandedExplanation is meant to be rendered
 * in-context on the entry's relatedRoute or wherever it's referenced, per
 * docs/landing-redesign/phase-6/aeo-answer-library.md.
 *
 * Definitional entries for universal, uncontested ERP/manufacturing
 * terminology (what is ERP, what is MRP, etc.) are not tied to an external
 * EDITORIAL_SOURCES entry — these are standard-usage definitions, not
 * competitor-specific or statistical claims requiring live verification
 * (see .claude/rules/landing-content.md rule 2's scope). Every entry that
 * describes what Vercentlabs specifically does is grounded in
 * docs/landing-redesign/phase-1/product-intelligence.md.
 */
export const AEO_ANSWERS = Object.freeze([
  {
    id: "what-is-erp",
    question: "What is ERP?",
    entity: "Enterprise Resource Planning (ERP)",
    directAnswer:
      "ERP (Enterprise Resource Planning) is a category of business software that runs an organisation's core operational processes — finance, sales, procurement, inventory, manufacturing, HR, and more — on one shared data model instead of separate, disconnected tools.",
    expandedExplanation:
      "The defining trait of ERP software, as distinct from a collection of point tools, is that departments read and write the same underlying records — a sales order and the invoice it generates are the same transaction seen from two modules, not two systems kept in sync by hand.",
    relatedRoute: "/resources/glossary/erp",
    lastReviewedAt: "2026-08-07",
  },
  {
    id: "what-is-mrp",
    question: "What is MRP (Material Requirements Planning)?",
    entity: "Material Requirements Planning (MRP)",
    directAnswer:
      "MRP (Material Requirements Planning) is the process of calculating what materials a manufacturer needs to buy or produce, and when, based on demand, existing inventory, and lead times.",
    expandedExplanation:
      "MRP runs produce recommended purchase, manufacture, transfer, or expedite actions against a bill of materials and current stock position — turning a production plan into a concrete materials plan rather than leaving procurement timing to guesswork.",
    relatedRoute: "/resources/glossary/mrp",
    lastReviewedAt: "2026-08-07",
  },
  {
    id: "what-is-a-bom",
    question: "What is a bill of materials (BOM)?",
    entity: "Bill of Materials (BOM)",
    directAnswer:
      "A bill of materials (BOM) is the structured list of every component, sub-assembly, and quantity required to manufacture one unit of a finished item.",
    expandedExplanation:
      "A BOM is the structural input every downstream manufacturing step depends on — a work order snapshots its materials and operations from the active BOM at creation time, so the BOM's accuracy directly determines whether production can actually run as planned.",
    relatedRoute: "/resources/glossary/bom",
    lastReviewedAt: "2026-08-07",
  },
  {
    id: "what-is-manufacturing-erp",
    question: "What is manufacturing ERP?",
    entity: "Manufacturing ERP",
    directAnswer:
      "Manufacturing ERP is ERP software that specifically covers production processes — bills of materials, work orders, routings, and material requirements planning — connected to the same inventory, procurement, and financial records the rest of the business uses.",
    expandedExplanation:
      "The real differentiator between manufacturing ERP and a standalone MRP tool is the connection: a work order in a manufacturing ERP consumes real stock, feeds real cost data into financial reporting, and is visible to procurement planning the same live records the shop floor uses.",
    relatedRoute: "/resources/manufacturing-erp-guide",
    lastReviewedAt: "2026-08-07",
  },
  {
    id: "what-is-procure-to-pay",
    question: "What is procure-to-pay (P2P)?",
    entity: "Procure to Pay",
    directAnswer:
      "Procure-to-pay (P2P) is the process from raising a purchase requisition through sourcing, purchase order, goods receipt, invoice matching, and payment.",
    expandedExplanation:
      "A governed procure-to-pay process gates each stage — a purchase order can only become a vendor bill once 2-, 3-, or 4-way matching confirms the order, receipt, and invoice actually agree, rather than trusting an invoice on its own.",
    relatedRoute: "/workflows/procure-to-pay",
    lastReviewedAt: "2026-08-07",
  },
  {
    id: "what-is-lead-to-cash",
    question: "What is lead-to-cash?",
    entity: "Lead to Cash",
    directAnswer:
      "Lead-to-cash is the process from capturing a sales lead through qualification, quotation, order confirmation, and invoicing — the full revenue cycle from first contact to collected payment.",
    expandedExplanation:
      "A connected lead-to-cash process means the same record moves through each stage — a won CRM opportunity becomes the literal source for a quotation, which becomes an order, which becomes an invoice — rather than four separately maintained documents someone has to keep in sync.",
    relatedRoute: "/workflows/lead-to-cash",
    lastReviewedAt: "2026-08-07",
  },
  {
    id: "what-is-multi-tenant-saas",
    question: "What is multi-tenant SaaS?",
    entity: "Multi-Tenant SaaS",
    directAnswer:
      "Multi-tenant SaaS is a software architecture where multiple customer organisations (tenants) share the same application infrastructure while their data stays structurally isolated from each other.",
    expandedExplanation:
      "The isolation has to be structural, not just a filtered view — a query scoped incorrectly in a multi-tenant system is a real data-leak risk, which is why tenant boundaries are typically enforced at the database and access-control layer, not only in application logic.",
    relatedRoute: "/resources/glossary/multi-tenant-saas",
    lastReviewedAt: "2026-08-07",
  },
  {
    id: "what-is-multi-company-erp",
    question: "What is multi-company ERP?",
    entity: "Multi-Company ERP",
    directAnswer:
      "Multi-company ERP is ERP software that supports running more than one legal entity, plant, or branch on one platform, with each entity's data and access structurally separated while still allowing consolidated reporting when needed.",
    expandedExplanation:
      "The real test of multi-company support isn't whether a second company record can be created — it's whether a user's access is genuinely scoped to the companies/branches they're granted, and whether roles can be time-bound and company-specific rather than an all-or-nothing switch.",
    relatedRoute: "/resources/glossary/multi-company-erp",
    lastReviewedAt: "2026-08-07",
  },
  {
    id: "what-is-rbac",
    question: "What is RBAC (role-based access control)?",
    entity: "Role-Based Access Control (RBAC)",
    directAnswer:
      "RBAC (role-based access control) is an access-control model where permissions are granted to roles rather than individual users, and users gain permissions by being assigned to a role.",
    expandedExplanation:
      "A real RBAC implementation for an ERP system typically needs role assignments that can be scoped (to a company, branch, or department) and time-bound (with a start and expiry date), so a contractor's or auditor's access doesn't outlive the engagement.",
    relatedRoute: "/resources/glossary/rbac",
    lastReviewedAt: "2026-08-07",
  },
  {
    id: "what-is-maker-checker",
    question: "What is maker-checker (segregation of duties)?",
    entity: "Maker-Checker",
    directAnswer:
      "Maker-checker (also called segregation of duties) is a control where the person who creates or prepares a transaction cannot also be the one who approves it.",
    expandedExplanation:
      "Enforcing maker-checker structurally — in the permission model, not just as a written policy — closes a common audit finding: a payroll run, a journal entry, or a purchase order approved by the same person who created it, with no independent check.",
    relatedRoute: "/resources/glossary/maker-checker",
    lastReviewedAt: "2026-08-07",
  },
  {
    id: "which-erp-modules-do-we-need-first",
    question: "Which ERP modules should we implement first?",
    entity: "ERP module sequencing",
    directAnswer:
      "Most organisations get the fastest value by implementing the module that owns their most acute, quantifiable operational pain first — commonly finance/accounting for close-process pain, or inventory/procurement for stockout and reconciliation pain — rather than attempting all modules simultaneously.",
    expandedExplanation:
      "A phased rollout also reduces change-management risk: a team learning one new governed process at a time adapts faster than a team facing a full-system cutover, and each phase's real usage data informs configuration decisions for the next.",
    relatedRoute: "/resources/erp-buying-guide",
    lastReviewedAt: "2026-08-07",
  },
  {
    id: "what-is-an-erp-implementation-checklist",
    question: "What should an ERP implementation checklist cover?",
    entity: "ERP Implementation Checklist",
    directAnswer:
      "A real ERP implementation checklist covers discovery and requirements gathering, data migration and reconciliation, configuration (roles, numbering, approval thresholds), integration testing, user training, a cutover plan, and a defined post-launch support period — not just a go-live date.",
    expandedExplanation:
      "The most commonly underestimated item is data migration reconciliation — confirming migrated customers, items, suppliers, and open transactions actually match the source system, not just that a migration script completed without erroring.",
    relatedRoute: "/resources/erp-implementation-checklist",
    lastReviewedAt: "2026-08-07",
  },
]);

export function getAnswer(id) {
  return AEO_ANSWERS.find((answer) => answer.id === id) || null;
}
