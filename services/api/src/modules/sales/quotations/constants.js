// The fixed vocabulary of quotations.
//
// Status codes are those the quotation table allows. Two keep older names:
// Confirmed is stored as 'approved' and Superseded as 'withdrawn'. Use the
// STATUS constants, never the raw strings. Expired is not stored: an open
// quotation whose Valid Until has passed is shown as expired.
export const STATUS = Object.freeze({
  draft: "draft",
  awaitingApproval: "pending_approval",
  confirmed: "approved",
  sent: "sent",
  accepted: "accepted",
  rejected: "rejected",
  cancelled: "cancelled",
  superseded: "withdrawn",
});

export const STATUS_KEYS = Object.freeze({
  draft: "draft", pending_approval: "awaiting_approval", approved: "confirmed", sent: "sent", accepted: "accepted", rejected: "rejected", cancelled: "cancelled",
  withdrawn: "superseded",
});
export const STATUS_LABELS = Object.freeze({
  draft: "Draft", awaiting_approval: "Awaiting approval", confirmed: "Confirmed", sent: "Sent", accepted: "Accepted", rejected: "Rejected", cancelled: "Cancelled",
  superseded: "Superseded", expired: "Expired",
});

// An offer the customer can still answer.
export const OPEN_STATUSES = Object.freeze([STATUS.confirmed, STATUS.sent]);
// Still being worked on or waiting for an answer.
export const ACTIVE_STATUSES = Object.freeze([STATUS.draft, STATUS.awaitingApproval, STATUS.confirmed, STATUS.sent]);

export const QUOTATION_PERMISSIONS = Object.freeze({
  view: "sales.quotation.view",
  viewTeam: "sales.quotation.view_team",
  viewAll: "sales.quotation.view_all",
  create: "sales.quotation.create",
  confirm: "sales.quotation.confirm",
  approve: "sales.quotation.approve",
  send: "sales.quotation.send",
  revise: "sales.quotation.revise",
  accept: "sales.quotation.accept_on_behalf",
  reject: "sales.quotation.reject",
  cancel: "sales.quotation.cancel",
  changeDate: "sales.quotation.change_date",
  export: "sales.quotation.export",
  overridePrice: "sales.price.override",
  applyDiscount: "sales.discount.apply",
  createOrder: "sales.order.create",
  viewCost: "sales.margin.view",
});

export const QUOTATION_VIEWS = Object.freeze([
  { key: "all", label: "All Quotations" },
  { key: "mine", label: "My Quotations" },
  { key: "team", label: "Team Quotations" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "awaiting", label: "Awaiting Response" },
  { key: "accepted", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
  { key: "expired", label: "Expired" },
  { key: "cancelled", label: "Cancelled" },
]);

export class QuotationError extends Error {
  constructor(status, message, code = "SALES_QUOTATION_ERROR", details = undefined) {
    super(message);
    this.name = "QuotationError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (value) => UUID.test(String(value ?? ""));
export function requireUuid(value, label = "Quotation") {
  if (!isUuid(value)) throw new QuotationError(400, `${label} is not valid.`, "SALES_QUOTATION_VALIDATION");
  return String(value);
}
export const text = (value, maximum = 4000) => {
  const result = value == null ? null : String(value).trim();
  return result ? result.slice(0, maximum) : null;
};
export const has = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key);
export const dayOf = (value) => (value ? (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10) : null);

// The status a person sees: the stored status, or Expired for an open offer past its date.
export function displayStatus(row, today) {
  const key = STATUS_KEYS[row.lifecycle_status] ?? row.lifecycle_status;
  const validUntil = dayOf(row.valid_until);
  const expired = OPEN_STATUSES.includes(row.lifecycle_status) && Boolean(validUntil) && validUntil < today;
  return { key: expired ? "expired" : key, label: STATUS_LABELS[expired ? "expired" : key] ?? key, storedKey: key, isExpired: expired };
}
