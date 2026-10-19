// The one catalogue of developer API scopes. A scope exists here only when a
// real /api/v1 endpoint consumes it; keys can be issued only with these, and
// a stored scope string that is not registered grants nothing. An API scope
// is a machine grant, not a human permission: it does not carry any user's
// roles or RBAC permissions.
export const API_SCOPES = Object.freeze([
  Object.freeze({
    key: "platform.context.read",
    displayName: "Read workspace context",
    description: "The organization's name, this app's identity, the key's scopes and the modules enabled for the organization.",
    risk: "low",
    consumedBy: Object.freeze(["GET /api/v1/platform/context"]),
  }),
  // Shared Platform plan 6: the core records, for connectors (Tally, Shopify, Busy) and the company's own tools.
  ...[
    ["customers.read", "Read customers", "Customers: number, names, GSTIN, status and addresses (no finance figures).", "medium", ["GET /api/v1/customers", "GET /api/v1/customers/{id}"]],
    ["customers.write", "Create customers", "Create customers, checked as on screen (duplicates, GSTIN).", "high", ["POST /api/v1/customers"]],
    ["items.read", "Read items", "Products and services: code, SKU, name, unit, HSN/SAC, prices (no costs).", "medium", ["GET /api/v1/items", "GET /api/v1/items/{id}"]],
    ["items.write", "Create items", "Create products and services, checked as on screen.", "high", ["POST /api/v1/items"]],
    ["sales_orders.read", "Read sales orders", "Sales orders with their lines, totals and status (no margins).", "medium", ["GET /api/v1/sales-orders", "GET /api/v1/sales-orders/{id}"]],
    ["sales_orders.write", "Create sales orders", "Create draft sales orders (a person confirms them).", "high", ["POST /api/v1/sales-orders"]],
    ["invoices.read", "Read invoices", "Sales invoices with totals, due dates and what is still due.", "medium", ["GET /api/v1/invoices", "GET /api/v1/invoices/{id}"]],
    ["stock.read", "Read stock levels", "Stock on hand, reserved and available per item and warehouse (no values).", "low", ["GET /api/v1/stock-levels"]],
    ["payments.read", "Read payments", "Customer payments received: amount, date, method and reference.", "medium", ["GET /api/v1/payments"]],
  ].map(([key, displayName, description, risk, consumedBy]) => Object.freeze({ key, displayName, description, risk, consumedBy: Object.freeze(consumedBy) })),
]);

const BY_KEY = new Map(API_SCOPES.map((scope) => [scope.key, scope]));

export function getApiScope(key) {
  return BY_KEY.get(String(key || "")) || null;
}

export const API_VERSION = "v1";
