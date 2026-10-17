// Entity types a Shared Platform file may belong to. A file row is only
// ever created for a registered type; the owning module (or, for platform
// artifacts, the platform) decides who may read or change it. A generic
// entity_type + entity_id pair is never an authorization by itself.
export const FILE_ENTITY_TYPES = Object.freeze({
  "crm.lead": { moduleKey: "crm", purposes: ["attachment"] },
  "crm.opportunity": { moduleKey: "crm", purposes: ["attachment"] },
  "crm.party": { moduleKey: "crm", purposes: ["attachment"] },
  "crm.contact": { moduleKey: "crm", purposes: ["attachment"] },
  "support.ticket": { moduleKey: "support", purposes: ["attachment", "inbound_mail"] },
  // Shared by every module that uses the catalogue; the product module checks access.
  "products.item": { moduleKey: null, purposes: ["attachment"] },
  "sales.quotation": { moduleKey: "sales", purposes: ["attachment"] },
  "sales.order": { moduleKey: "sales", purposes: ["attachment"] },
  // The exact PDF of each order confirmation that was emailed.
  "sales.order_confirmation": { moduleKey: "sales", purposes: ["attachment"] },
  // Proof of delivery: the signed delivery note, photos, the customer's acknowledgement.
  "sales.delivery": { moduleKey: "sales", purposes: ["attachment"] },
  // Files on a sales invoice, and the exact PDFs emailed to the customer.
  "sales.invoice": { moduleKey: "sales", purposes: ["attachment"] },
  // Files on a sales return: the customer's request, photos, the signed return receipt.
  "sales.return": { moduleKey: "sales", purposes: ["attachment"] },
  // Files on a credit note: the customer's claim, photos, approvals, and the exact PDFs emailed.
  "sales.credit_note": { moduleKey: "sales", purposes: ["attachment"] },
  // Files on a customer refund: the bank advice, the customer's request, and the exact vouchers emailed.
  "accounting.customer_refund": { moduleKey: "accounting", purposes: ["attachment"] },
  // Files on a supplier: contracts, rate cards, tax and quality certificates, company profile, correspondence.
  "procurement.supplier": { moduleKey: "procurement", purposes: ["attachment"] },
  // Files on a purchase order (quotations, specifications, drawings, contracts) and the exact PDFs emailed to the supplier.
  "procurement.purchase_order": { moduleKey: "procurement", purposes: ["attachment"] },
  // Files on a goods receipt: the supplier challan, packing slips, photos of damaged goods.
  "procurement.goods_receipt": { moduleKey: "procurement", purposes: ["attachment"] },
  // Evidence on a receiving rejection: photos, inspection records, supplier correspondence.
  "procurement.receiving_rejection": { moduleKey: "procurement", purposes: ["attachment"] },
  // On a supplier bill: the supplier's original invoice (PDF or image) and supporting documents.
  "procurement.supplier_bill": { moduleKey: "procurement", purposes: ["attachment"] },
  "procurement.purchase_return": { moduleKey: "procurement", purposes: ["attachment"] },
  // On an opening stock document: the migration evidence (legacy stock reports, count sheets, valuation workings).
  // Evidence on a production quality inspection: photos of defects, measurement sheets, test records.
  "manufacturing.quality_inspection": { moduleKey: "manufacturing", purposes: ["attachment"] },
  // Evidence on a production hold: incident reports, photos, supplier confirmations, clearance records.
  "manufacturing.production_hold": { moduleKey: "manufacturing", purposes: ["attachment"] },
  // Project documents: requirements, scope of work, customer approvals, drawings, references and delivery evidence.
  "projects.project": { moduleKey: "projects", purposes: ["attachment"] },
  // A milestone's deliverables and acceptance evidence.
  "projects.milestone": { moduleKey: "projects", purposes: ["attachment"] },
  "projects.task": { moduleKey: "projects", purposes: ["attachment"] },
  // Files attached to a project discussion comment; the comment's record (project, task or milestone) decides who may read them.
  "projects.comment": { moduleKey: "projects", purposes: ["attachment"] },
  // Receipts and invoices on a project expense claim; the expense (and its project) decides who may read them.
  "projects.expense": { moduleKey: "projects", purposes: ["attachment"] },
  // An asset's photos, manuals, purchase invoices, warranty certificates; the asset decides who may read them.
  "assets.asset": { moduleKey: "assets", purposes: ["attachment"] },
  "stock.opening_stock": { moduleKey: "stock", purposes: ["attachment"] },
  "stock.goods_issue": { moduleKey: "stock", purposes: ["attachment"] },
  "stock.inventory_adjustment": { moduleKey: "stock", purposes: ["attachment"] },
  // An inspection specification's drawings, standards, test procedures and reference photos; the specification decides who may read them.
  "quality.specification": { moduleKey: "quality", purposes: ["attachment"] },
  // On a quality hold: inspection notes, photos, certificates, supplier correspondence.
  "stock.inventory_stock_hold": { moduleKey: "stock", purposes: ["attachment"] },
  "platform.export": { moduleKey: null, purposes: ["export"] },
  "platform.report_run": { moduleKey: null, purposes: ["report_output"] },
});

export function getFileEntityType(entityType) {
  return FILE_ENTITY_TYPES[String(entityType || "")] || null;
}
