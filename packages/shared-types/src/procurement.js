export const PROCUREMENT_RESOURCE_KEYS = Object.freeze([
  "suppliers", "supplier-sites", "supplier-qualifications", "supplier-certifications",
  "supplier-scorecards", "categories", "catalogs", "catalog-items", "requisitions",
  "sourcing-events", "sourcing-invitations", "sourcing-bids", "sourcing-evaluations",
  "agreements", "purchase-orders", "advance-shipping-notices", "receipts",
  "service-entries", "returns", "match-exceptions", "policies", "source-rules",
  "portal-users", "outbox"
]);
export const PROCUREMENT_REPORT_KEYS = Object.freeze([
  "spend-analysis", "supplier-performance", "purchase-price-variance", "contract-compliance",
  "maverick-spend", "open-commitments", "overdue-orders", "matching-exceptions",
  "savings", "cycle-time", "supplier-risk", "agreement-consumption"
]);
export const PROCUREMENT_DOCUMENT_STATES = Object.freeze([
  "draft", "submitted", "pending_approval", "approved", "rejected", "active",
  "dispatched", "acknowledged", "partially_received", "received", "closed", "cancelled"
]);
