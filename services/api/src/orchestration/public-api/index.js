// The public API's records (Shared Platform plan 6): customers, items, sales orders, invoices, stock levels and payments, for Tally,
// Shopify, Busy and the company's own tools. A call runs under a narrow machine context made from its scope — exactly the
// permissions that scope grants (never a person's roles, never costs, margins or finance details the scope does not name) — and the
// app's own list, read and create functions, so validation, numbering and visibility are the same as on screen. Writes are recorded
// as made by the person who created the developer app.
import { createCustomer, getCustomer, listCustomers } from "../../modules/sales/customers/records.js";
import { createProduct, getProduct, listProducts } from "../../modules/products/records.js";
import { createSalesOrder, getSalesOrder, listSalesOrders } from "../../modules/sales/orders/records.js";
import { getSalesInvoice, listSalesInvoices } from "../../modules/sales/invoices/records.js";
import { getStockBalance } from "../../modules/stock/balances.js";
import { getEnabledModuleKeys } from "../../core/access/index.js";

// scope -> the permissions it grants (and nothing else).
export const API_SCOPE_PERMISSIONS = Object.freeze({
  "customers.read": ["sales.customers.view", "sales.customers.view_all"],
  "customers.write": ["sales.customers.view", "sales.customers.view_all", "sales.customers.create"],
  "items.read": ["products.view"],
  "items.write": ["products.view", "products.create"],
  "sales_orders.read": ["sales.view", "sales.order.view", "sales.order.view_all"],
  "sales_orders.write": ["sales.view", "sales.order.view", "sales.order.view_all", "sales.order.create", "sales.customers.view", "sales.customers.view_all", "products.view"],
  "invoices.read": ["sales.view", "sales.invoice.view", "sales.invoice.view_all"],
  "stock.read": ["stock.view", "warehouses.view"],
  "payments.read": [],
});

export class PublicApiError extends Error {
  constructor(status, message, code = "VALIDATION_FAILED") {
    super(message);
    this.name = "PublicApiError";
    this.status = status;
    this.code = code;
  }
}

// The app a scope reads from must be switched on for the company (items are shared by Sales, Procurement and Inventory).
const SCOPE_MODULES = Object.freeze({ customers: ["sales"], items: ["sales", "procurement", "stock"], sales_orders: ["sales"], invoices: ["sales"], stock: ["stock"] });

async function machineContext(client, principal, scope) {
  const needs = SCOPE_MODULES[scope.split(".")[0]];
  if (needs) {
    const enabled = await getEnabledModuleKeys(client, principal.organizationId);
    if (!needs.some((key) => enabled.has(key))) throw new PublicApiError(403, "The app these records belong to is not switched on for this company.", "API_MODULE_DISABLED");
  }
  const actor = (await client.query(`SELECT created_by FROM public.developer_apps WHERE organization_id = $1 AND id = $2`, [principal.organizationId, principal.developerAppId])).rows[0]?.created_by ?? null;
  return { organizationId: principal.organizationId, userId: actor, permissions: [...(API_SCOPE_PERMISSIONS[scope] ?? [])], roleSlugs: [], apiKeyId: principal.apiKeyId, origin: "api" };
}
// ?limit=&offset= (at most 200 a page) and the record list's own filters.
const page = (query) => ({ limit: Math.min(Math.max(Number(query.limit) || 50, 1), 200), offset: Math.max(Number(query.offset) || 0, 0) });
const pick = (query, keys) => Object.fromEntries(keys.filter((key) => query[key] !== undefined && query[key] !== "").map((key) => [key, String(query[key]).slice(0, 200)]));

export async function apiListCustomers(client, principal, query = {}) {
  const result = await listCustomers(client, await machineContext(client, principal, "customers.read"), { ...pick(query, ["search", "status", "updatedFrom"]), ...page(query) });
  return { data: result.customers, total: result.total, limit: result.limit, offset: result.offset };
}
export async function apiGetCustomer(client, principal, id) {
  return { data: await getCustomer(client, await machineContext(client, principal, "customers.read"), id) };
}
export async function apiCreateCustomer(client, principal, input) {
  return { data: await createCustomer(client, await machineContext(client, principal, "customers.write"), { ...input, origin: "api" }) };
}

export async function apiListItems(client, principal, query = {}) {
  const result = await listProducts(client, await machineContext(client, principal, "items.read"), { ...pick(query, ["search", "status", "type"]), ...page(query) });
  return { data: result.products, total: result.total, limit: result.limit ?? page(query).limit, offset: result.offset ?? page(query).offset };
}
export async function apiGetItem(client, principal, id) {
  return { data: await getProduct(client, await machineContext(client, principal, "items.read"), id) };
}
export async function apiCreateItem(client, principal, input) {
  return { data: await createProduct(client, await machineContext(client, principal, "items.write"), input, { origin: "api" }) };
}

export async function apiListSalesOrders(client, principal, query = {}) {
  const result = await listSalesOrders(client, await machineContext(client, principal, "sales_orders.read"), { ...pick(query, ["search", "status", "view", "dateFrom", "dateTo"]), ...page(query) });
  return { data: result.rows, total: result.total, limit: page(query).limit, offset: page(query).offset };
}
export async function apiGetSalesOrder(client, principal, id) {
  return { data: await getSalesOrder(client, await machineContext(client, principal, "sales_orders.read"), id) };
}
export async function apiCreateSalesOrder(client, principal, input) {
  const context = await machineContext(client, principal, "sales_orders.write");
  if (!context.userId) throw new PublicApiError(409, "The developer app has no owner to record the order under. Recreate the app.", "API_APP_OWNER_MISSING");
  return { data: await createSalesOrder(client, context, { ownerUserId: context.userId, ...input }) };
}

export async function apiListInvoices(client, principal, query = {}) {
  const result = await listSalesInvoices(client, await machineContext(client, principal, "invoices.read"), { ...pick(query, ["search", "status", "view", "dateFrom", "dateTo"]), ...page(query) });
  return { data: result.rows, total: result.total, limit: result.limit, offset: result.offset };
}
export async function apiGetInvoice(client, principal, id) {
  return { data: await getSalesInvoice(client, await machineContext(client, principal, "invoices.read"), id) };
}

// Stock on hand per item and warehouse (never its value).
export async function apiStockLevels(client, principal, query = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || 200, 1), 1000);
  const result = await getStockBalance(client, await machineContext(client, principal, "stock.read"), { view: "warehouse", ...pick(query, ["search", "itemId", "warehouseId"]), limit, offset: Math.max(Number(query.offset) || 0, 0) });
  return { data: result.rows.map(({ value: _value, ...row }) => row), total: result.total, limit: result.limit, offset: result.offset };
}

// Customer payments received (posted receipts), newest first: what was paid, when, how, and how much is still unapplied.
export async function apiListPayments(client, principal, query = {}) {
  const { limit, offset } = page(query);
  const values = [principal.organizationId];
  const where = ["receipt.organization_id = $1", "receipt.status = 'posted'"];
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(query.dateFrom ?? ""))) { values.push(query.dateFrom); where.push(`receipt.receipt_date >= $${values.length}::date`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(query.dateTo ?? ""))) { values.push(query.dateTo); where.push(`receipt.receipt_date <= $${values.length}::date`); }
  if (/^[0-9a-f-]{36}$/i.test(String(query.customerId ?? ""))) { values.push(query.customerId); where.push(`receipt.party_id = $${values.length}`); }
  const rows = (await client.query(
    `SELECT receipt.id, receipt.receipt_number, receipt.party_id, party.display_name AS customer_name, to_char(receipt.receipt_date, 'YYYY-MM-DD') AS receipt_date, receipt.currency_code,
            receipt.amount::text, receipt.unapplied_amount::text, receipt.payment_method, receipt.external_reference, count(*) OVER () AS total_count
       FROM tenant.accounting_customer_receipts receipt LEFT JOIN tenant.business_parties party ON party.organization_id = receipt.organization_id AND party.id = receipt.party_id
      WHERE ${where.join(" AND ")} ORDER BY receipt.receipt_date DESC, receipt.receipt_number DESC LIMIT ${limit} OFFSET ${offset}`, values)).rows;
  return {
    data: rows.map((row) => ({ id: row.id, receiptNumber: row.receipt_number, customerId: row.party_id, customerName: row.customer_name, receiptDate: row.receipt_date,
      currencyCode: row.currency_code?.trim(), amount: row.amount, unappliedAmount: row.unapplied_amount, paymentMethod: row.payment_method, reference: row.external_reference })),
    total: Number(rows[0]?.total_count ?? 0), limit, offset,
  };
}
