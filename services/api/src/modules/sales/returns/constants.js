// The vocabulary of sales returns.
//
// A sales return records goods coming back from the customer against a
// delivery. Draft (prepared; no stock moves) → Received (the goods are back
// in stock; fixed), or a draft Cancelled. The reason says why the goods came
// back; the condition (disposition) says what is done with them: Restock
// makes them sellable again, Inspection / Hold and Damaged keep them in a
// quality location, out of what can be sold. A return never changes the
// delivery or the invoice: what was delivered and invoiced stays, and the
// financial correction is a credit note against the original invoice.
import { OrderError } from "../orders/constants.js";

export const RETURN_STATUS = Object.freeze({ draft: "draft", received: "received", cancelled: "cancelled" });
export const RETURN_STATUS_LABELS = Object.freeze({ draft: "Draft", received: "Received", cancelled: "Cancelled" });

export const RETURN_REASONS = Object.freeze([
  { code: "damaged_product", label: "Damaged product" },
  { code: "defective_product", label: "Defective product" },
  { code: "wrong_product", label: "Wrong product" },
  { code: "wrong_quantity", label: "Wrong quantity" },
  { code: "changed_mind", label: "Customer changed mind" },
  { code: "not_as_expected", label: "Product not as expected" },
  { code: "shipping_damage", label: "Shipping damage" },
  { code: "duplicate_shipment", label: "Duplicate shipment" },
  { code: "quality_issue", label: "Quality issue" },
  { code: "order_cancellation", label: "Order cancellation" },
  { code: "other", label: "Other" },
]);

// What happens to the goods once back; held conditions go to a quality location of the warehouse.
export const DISPOSITIONS = Object.freeze([
  { code: "restock", label: "Restock", sellable: true },
  { code: "inspection", label: "Inspection / Hold", sellable: false, location: { code: "RETURNS-HOLD", name: "Returns: inspection / hold" } },
  { code: "damaged", label: "Damaged", sellable: false, location: { code: "RETURNS-DAMAGED", name: "Returns: damaged" } },
  { code: "other", label: "Other (held)", sellable: false, location: { code: "RETURNS-HOLD", name: "Returns: inspection / hold" } },
]);
export const dispositionOf = (code) => DISPOSITIONS.find((entry) => entry.code === code) ?? null;
export const reasonLabel = (code) => RETURN_REASONS.find((entry) => entry.code === code)?.label ?? code;

export const RETURN_PERMISSIONS = Object.freeze({
  view: "sales.return.view",
  viewAll: "sales.return.view_all",
  create: "sales.return.create",
  edit: "sales.return.edit",
  receive: "sales.return.receive",
  selectWarehouse: "sales.return.select_warehouse",
  print: "sales.return.print",
  creditNote: "sales.return.credit_note",
});

export const RETURN_VIEWS = Object.freeze([
  { key: "all", label: "All Returns" },
  { key: "draft", label: "Draft" },
  { key: "received", label: "Received" },
  { key: "awaiting_credit", label: "Awaiting Credit Note" },
  { key: "cancelled", label: "Cancelled" },
  { key: "mine", label: "My Returns" },
]);

export class ReturnError extends OrderError {
  constructor(status, message, code = "SALES_RETURN_ERROR", details = undefined) {
    super(status, message, code, details);
    this.name = "ReturnError";
  }
}
