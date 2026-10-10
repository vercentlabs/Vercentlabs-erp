// Stores & Outlets: the selling location every POS transaction belongs to — one entity (tenant.pos_stores), shown as "Store / Outlet". It
// is not a Warehouse, Customer, tax system or accounting entity: it points at the company's own records and never copies them.
//
// - Stock: the outlet names its selling warehouse (and optionally a selling and a returns location in it). Quantities are read from
//   Inventory's balances; nothing here stores or edits a quantity.
// - Tax: the outlet sells under one of the company's GST registrations; there is no GSTIN typed on an outlet.
// - Prices, walk-in customer, accounts: references to the Sales price list, the Sales customer and the company's chart of accounts.
// - Lifecycle: a new outlet is saved Inactive and activated once validateOutletSetup() finds nothing missing. It is deactivated only when
//   nothing operational is open there (shifts, carts, terminals, reconciliations, failed postings); it is deleted only if never used.
// - Defaults affect future transactions only: sales, returns and receipts keep what they were made with.
// - Access: who may work at an outlet is the cashiers given access to it (Cashiers, pos_cashier_outlets), enforced server-side by assertPosStoreAccess.
import { POS_OUTLET_PERMISSIONS as P } from "@vercentlabs/permissions";

import { restrictedStockSql } from "../../stock/rules.js";
import { registeredPaymentProviderKeys } from "../tender-and-payment-execution/adapter.js";
import { listOutletCashiers } from "../cashiers/index.js";

export class PosOutletError extends Error {
  constructor(status, message, code = "POS_OUTLET_ERROR", details = undefined) {
    super(message);
    this.name = "PosOutletError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const OUTLET_TYPES = Object.freeze([
  { code: "retail_store", label: "Retail store" }, { code: "showroom", label: "Showroom" }, { code: "kiosk", label: "Kiosk" }, { code: "other", label: "Other" },
]);
export const OUTLET_PAYMENT_METHODS = Object.freeze([
  { code: "cash", label: "Cash" }, { code: "card", label: "Card" }, { code: "upi", label: "UPI" }, { code: "wallet", label: "Digital wallet" },
  { code: "bank_transfer", label: "Bank transfer" },
]);
export const WEEKDAYS = Object.freeze(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
const METHOD_CODES = OUTLET_PAYMENT_METHODS.map((entry) => entry.code);
const CODE = /^[A-Z0-9][A-Z0-9._/-]{0,29}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const SALE_STATUSES = "('completed', 'partially_returned', 'returned')";

const BYPASS_ROLES = ["organization_owner", "system_administrator"];
const can = (c, permission) => Boolean(c.roleSlugs?.some((slug) => BYPASS_ROLES.includes(slug)) || c.permissions?.includes(permission));
const require = (c, permission, message) => { if (!can(c, permission)) throw new PosOutletError(403, message, "PERMISSION_DENIED"); };
const text = (value, max = 500) => { const out = String(value ?? "").trim().replace(/\s+/g, " "); return out ? out.slice(0, max) : null; };
const has = (input, key) => Object.prototype.hasOwnProperty.call(input ?? {}, key);
const issue = (field, message, code = "POS_OUTLET_VALIDATION", status = 400) => new PosOutletError(status, message, code, { issues: [{ field, message }] });
const uuid = (value, label) => { const id = String(value ?? "").trim(); if (!UUID.test(id)) throw new PosOutletError(400, `${label} is not valid.`, "POS_OUTLET_VALIDATION"); return id; };
const optionalId = (value, label) => (value === null || value === undefined || value === "" ? null : uuid(value, label));
const n = (value) => Number(value ?? 0);
const round = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
export const normalizeOutletCode = (value) => String(value ?? "").normalize("NFKC").trim().toUpperCase();

async function history(client, c, storeId, eventType, summary, changes = {}, reason = null) {
  await client.query(
    `INSERT INTO tenant.pos_store_history (organization_id, store_id, event_type, summary, changes, reason, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [c.organizationId, storeId, eventType, String(summary).slice(0, 500), JSON.stringify(changes), reason, c.userId ?? null]);
}

export function outletCapabilities(c) {
  return Object.fromEntries(Object.entries(P).map(([name, permission]) => [name, can(c, permission)]));
}

// ------------------------------------------------------------------ reading

const SELECT = `
  SELECT outlet.*, manager.full_name AS manager_name,
         warehouse.code AS warehouse_code, warehouse.name AS warehouse_name, warehouse.status AS warehouse_status,
         selling.code AS selling_location_code, selling.name AS selling_location_name,
         returns.code AS returns_location_code, returns.name AS returns_location_name,
         registration.code AS registration_code, registration.name AS registration_name, registration.registration_number, registration.state_code AS registration_state_code,
         registration.legal_name AS registration_legal_name, registration.status AS registration_status,
         price_list.code AS price_list_code, price_list.name AS price_list_name,
         customer.display_name AS customer_name, customer.customer_number,
         cash_account.code AS cash_account_code, cash_account.name AS cash_account_name,
         (SELECT count(*)::int FROM tenant.pos_terminals terminal WHERE terminal.organization_id = outlet.organization_id AND terminal.store_id = outlet.id) AS terminal_count,
         (SELECT count(*)::int FROM tenant.pos_terminals terminal WHERE terminal.organization_id = outlet.organization_id AND terminal.store_id = outlet.id AND terminal.status = 'active') AS active_terminal_count,
         (SELECT count(*)::int FROM tenant.pos_shifts shift WHERE shift.organization_id = outlet.organization_id AND shift.store_id = outlet.id AND shift.status IN ('open', 'closing')) AS open_session_count
    FROM tenant.pos_stores outlet
    LEFT JOIN public.users manager ON manager.id = outlet.manager_user_id
    LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = outlet.organization_id AND warehouse.id = outlet.warehouse_id
    LEFT JOIN tenant.warehouse_locations selling ON selling.organization_id = outlet.organization_id AND selling.id = outlet.selling_location_id
    LEFT JOIN tenant.warehouse_locations returns ON returns.organization_id = outlet.organization_id AND returns.id = outlet.returns_location_id
    LEFT JOIN tenant.tax_registrations registration ON registration.organization_id = outlet.organization_id AND registration.id = outlet.tax_registration_id
    LEFT JOIN tenant.price_lists price_list ON price_list.organization_id = outlet.organization_id AND price_list.id = outlet.price_list_id
    LEFT JOIN tenant.business_parties customer ON customer.organization_id = outlet.organization_id AND customer.id = outlet.default_customer_id
    LEFT JOIN tenant.accounting_accounts cash_account ON cash_account.organization_id = outlet.organization_id AND cash_account.id = outlet.cash_account_id`;

const label = (code, name) => (code ? `${code} · ${name}` : null);

function toOutlet(row, c) {
  const address = [row.address_line1, row.address_line2, row.city, row.state, row.postal_code, row.country_code].filter(Boolean);
  const finance = can(c, P.viewFinance);
  return {
    id: row.id, code: row.code, name: row.name, type: row.outlet_type, typeLabel: OUTLET_TYPES.find((entry) => entry.code === row.outlet_type)?.label ?? row.outlet_type,
    status: row.active ? "active" : "inactive", isActive: row.active,
    address: { line1: row.address_line1, line2: row.address_line2, city: row.city, state: row.state, stateCode: row.state_code, postalCode: row.postal_code, countryCode: row.country_code },
    addressText: address.join(", "), timezone: row.timezone, currencyCode: row.currency_code?.trim() ?? null,
    managerUserId: row.manager_user_id, managerName: row.manager_name, phone: row.phone, email: row.email,
    warehouseId: row.warehouse_id, warehouse: label(row.warehouse_code, row.warehouse_name), warehouseActive: row.warehouse_status === "active",
    sellingLocationId: row.selling_location_id, sellingLocation: label(row.selling_location_code, row.selling_location_name),
    returnsLocationId: row.returns_location_id, returnsLocation: label(row.returns_location_code, row.returns_location_name),
    taxRegistrationId: row.tax_registration_id, taxRegistration: label(row.registration_code, row.registration_name),
    gstin: row.registration_number ?? null, registrationStateCode: row.registration_state_code ?? null, legalName: row.registration_legal_name ?? null,
    priceListId: row.price_list_id, priceList: label(row.price_list_code, row.price_list_name),
    // Walk-in sales are a mode of the bill, never a placeholder customer.
    walkIn: { allowWalkInSales: row.allow_walk_in_sales !== false, allowOptionalBuyerName: row.allow_optional_buyer_name !== false,
      allowReceiptContactCapture: row.allow_receipt_contact_capture !== false },
    // The cash account is Finance's: only those who may see outlet finance details see which one it is.
    cashAccountId: finance ? row.cash_account_id : null, cashAccount: finance ? label(row.cash_account_code, row.cash_account_name) : null,
    receiptMessage: row.receipt_message, businessHours: row.business_hours ?? {}, notes: row.notes,
    terminals: n(row.terminal_count), activeTerminals: n(row.active_terminal_count), openSessions: n(row.open_session_count),
    version: n(row.version || 1), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// Outlets the person may see: everyone with View Outlets sees every outlet, except that a person listed on some outlets (and not an
// outlet administrator) sees only those — the same boundary the POS screens enforce.
async function visibleOutletIds(client, c) {
  if (c.roleSlugs?.some((slug) => BYPASS_ROLES.includes(slug))) return null;
  if (["pos.store.manage", "pos.settings.manage", P.create, P.edit].some((permission) => c.permissions?.includes(permission))) return null;
  const { rows } = await client.query(`SELECT access.store_id FROM tenant.pos_cashier_outlets access JOIN tenant.pos_cashiers cashier ON cashier.organization_id = access.organization_id
    AND cashier.id = access.cashier_id WHERE access.organization_id = $1 AND cashier.user_id = $2`, [c.organizationId, c.userId ?? null]);
  return rows.length ? rows.map((row) => row.store_id) : null;
}

// filters: view (all | active | inactive | mine), search (code, name, city, state, GST registration), state, city, warehouseId, managerUserId,
// status.
export async function listOutlets(client, c, filters = {}) {
  require(c, P.view, "You do not have permission to view stores and outlets.");
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["outlet.organization_id = $1"];
  const view = filters.view ?? "all";
  if (view === "active" || filters.status === "active") where.push("outlet.active");
  if (view === "inactive" || filters.status === "inactive") where.push("NOT outlet.active");
  if (view === "mine") where.push(`(outlet.manager_user_id = ${bind(c.userId ?? null)} OR EXISTS (SELECT 1 FROM tenant.pos_cashier_outlets access JOIN tenant.pos_cashiers cashier
    ON cashier.organization_id = access.organization_id AND cashier.id = access.cashier_id WHERE access.organization_id = outlet.organization_id AND access.store_id = outlet.id
    AND cashier.user_id = ${bind(c.userId ?? null)}))`);
  const term = text(filters.search);
  if (term) where.push(`lower(concat_ws(' ', outlet.code, outlet.name, outlet.city, outlet.state, registration.code, registration.name, registration.registration_number)) LIKE ${bind(`%${term.toLowerCase()}%`)}`);
  if (text(filters.state)) where.push(`lower(outlet.state) = lower(${bind(text(filters.state))})`);
  if (text(filters.city)) where.push(`lower(outlet.city) = lower(${bind(text(filters.city))})`);
  if (filters.warehouseId && UUID.test(filters.warehouseId)) where.push(`outlet.warehouse_id = ${bind(filters.warehouseId)}`);
  if (filters.managerUserId && UUID.test(filters.managerUserId)) where.push(`outlet.manager_user_id = ${bind(filters.managerUserId)}`);
  const visible = await visibleOutletIds(client, c);
  if (visible) where.push(`outlet.id = ANY(${bind(visible)}::uuid[])`);
  const { rows } = await client.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY outlet.active DESC, lower(outlet.name)`, values);
  return { outlets: rows.map((row) => toOutlet(row, c)), capabilities: outletCapabilities(c) };
}

async function loadOutlet(client, c, outletId, { lock = false } = {}) {
  const id = uuid(outletId, "Outlet");
  if (lock) await client.query(`SELECT id FROM tenant.pos_stores WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, id]);
  const row = (await client.query(`${SELECT} WHERE outlet.organization_id = $1 AND outlet.id = $2`, [c.organizationId, id])).rows[0];
  if (!row) throw new PosOutletError(404, "Store / outlet not found.", "POS_OUTLET_NOT_FOUND");
  return row;
}

async function assertVisible(client, c, outletId) {
  const visible = await visibleOutletIds(client, c);
  if (visible && !visible.includes(outletId)) throw new PosOutletError(404, "Store / outlet not found.", "POS_OUTLET_NOT_FOUND");
}

// The outlet with its setup check, today's sales, payment methods and documents.
export async function getOutlet(client, c, outletId) {
  require(c, P.view, "You do not have permission to view stores and outlets.");
  const row = await loadOutlet(client, c, outletId);
  await assertVisible(client, c, row.id);
  const outlet = toOutlet(row, c);
  const today = can(c, P.viewTransactions) ? (await client.query(
    `SELECT count(*)::int AS sales, COALESCE(sum(grand_total), 0) AS total FROM tenant.pos_sales
      WHERE organization_id = $1 AND store_id = $2 AND status IN ${SALE_STATUSES}
        AND (completed_at AT TIME ZONE $3)::date = (now() AT TIME ZONE $3)::date`, [c.organizationId, row.id, row.timezone || "Asia/Kolkata"])).rows[0] : null;
  return {
    ...outlet,
    today: today ? { sales: today.sales, total: round(today.total) } : null,
    paymentMethods: await getOutletPaymentMethods(client, c, row.id),
    documents: await outletDocuments(client, c, row),
    setup: await setupIssues(client, c, row),
    capabilities: outletCapabilities(c),
  };
}

// ------------------------------------------------------------------ writing the outlet

async function memberOrFail(client, c, userId, field) {
  if (!userId) return null;
  const id = uuid(userId, "User");
  if (!(await client.query(`SELECT 1 FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`, [c.organizationId, id])).rows[0])
    throw issue(field, "Choose an active member of the workspace.");
  return id;
}

function readHours(value) {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw issue("businessHours", "Business hours are not valid.");
  const out = {};
  for (const day of WEEKDAYS) {
    const entry = value[day];
    if (!entry) continue;
    if (entry.closed === true) { out[day] = { closed: true }; continue; }
    const opens = text(entry.opens, 5);
    const closes = text(entry.closes, 5);
    if (!opens && !closes) continue;
    if (!TIME.test(opens ?? "") || !TIME.test(closes ?? "")) throw issue("businessHours", `Enter ${day[0].toUpperCase()}${day.slice(1)}'s hours as HH:MM, such as 09:00 and 21:00.`);
    out[day] = { opens, closes };
  }
  return out;
}

function readOutlet(input, current = null) {
  const pick = (key, column, max) => (has(input, key) ? text(input[key], max) : current?.[column] ?? null);
  const address = input.address ?? {};
  const addr = (key, column, max) => (has(address, key) ? text(address[key], max) : has(input, key) ? text(input[key], max) : current?.[column] ?? null);
  const type = has(input, "type") ? String(input.type ?? "") : current?.outlet_type ?? "retail_store";
  return {
    name: pick("name", "name", 160), type,
    line1: addr("line1", "address_line1", 200), line2: addr("line2", "address_line2", 200), city: addr("city", "city", 100), state: addr("state", "state", 100),
    stateCode: addr("stateCode", "state_code", 10), postalCode: addr("postalCode", "postal_code", 20),
    countryCode: (addr("countryCode", "country_code", 2) ?? "").toUpperCase() || null,
    timezone: pick("timezone", "timezone", 64), phone: pick("phone", "phone", 40), email: pick("email", "email", 200),
    receiptMessage: has(input, "receiptMessage") ? text(input.receiptMessage, 300) : current?.receipt_message ?? null,
    notes: has(input, "notes") ? text(input.notes, 2000) : current?.notes ?? null,
    businessHours: has(input, "businessHours") ? readHours(input.businessHours) : current?.business_hours ?? {},
  };
}

function validateOutletValues(values) {
  if (!values.name) throw issue("name", "Enter the outlet name.");
  if (!OUTLET_TYPES.some((entry) => entry.code === values.type)) throw issue("type", "Choose Retail store, Showroom, Kiosk or Other.");
  if (values.countryCode && !/^[A-Z]{2}$/.test(values.countryCode)) throw issue("countryCode", "Use the two-letter country code, such as IN.");
  if (values.stateCode && !/^[0-9A-Z]{1,10}$/.test(values.stateCode)) throw issue("stateCode", "Use the GST state code, such as 27 for Maharashtra.");
  if (values.email && !EMAIL.test(values.email)) throw issue("email", "Enter a valid email address.");
  if (values.timezone) {
    try { new Intl.DateTimeFormat("en", { timeZone: values.timezone }); } catch { throw issue("timezone", "Choose a valid time zone, such as Asia/Kolkata."); }
  }
}

async function checkCode(client, c, code, exceptId = null) {
  if (!CODE.test(code)) throw issue("code", "Use up to 30 letters, numbers, dots, dashes or slashes, such as PUN-FC.");
  const clash = (await client.query(`SELECT name FROM tenant.pos_stores WHERE organization_id = $1 AND upper(btrim(code)) = $2 AND ($3::uuid IS NULL OR id <> $3)`,
    [c.organizationId, code, exceptId])).rows[0];
  if (clash) throw issue("code", `${code} is already the code of ${clash.name}.`, "POS_OUTLET_DUPLICATE", 409);
}

// The selling warehouse: the company's own, active, a place that can ship (not transit).
async function checkWarehouse(client, c, warehouseId) {
  const id = uuid(warehouseId, "Selling warehouse");
  const warehouse = (await client.query(`SELECT id, status, warehouse_type, code FROM tenant.warehouses WHERE organization_id = $1 AND id = $2`, [c.organizationId, id])).rows[0];
  if (!warehouse) throw issue("warehouseId", "Choose a warehouse of the company.", "POS_OUTLET_WAREHOUSE_INVALID");
  if (warehouse.status !== "active") throw issue("warehouseId", `${warehouse.code} is inactive. Choose an active warehouse to sell from.`, "POS_OUTLET_WAREHOUSE_INVALID");
  if (warehouse.warehouse_type === "transit") throw issue("warehouseId", `${warehouse.code} is a transit warehouse. Choose a warehouse that holds sellable stock.`, "POS_OUTLET_WAREHOUSE_INVALID");
  return id;
}

async function checkLocation(client, c, locationId, warehouseId, field, labelText) {
  const id = optionalId(locationId, labelText);
  if (!id) return null;
  const location = (await client.query(`SELECT warehouse_id, status, allow_stock, code FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = $2`, [c.organizationId, id])).rows[0];
  if (!location || location.warehouse_id !== warehouseId) throw issue(field, `The ${labelText.toLowerCase()} must be a location of the selling warehouse.`, "POS_OUTLET_LOCATION_INVALID");
  if (location.status !== "active" || !location.allow_stock) throw issue(field, `${location.code} is inactive or does not hold stock. Choose another ${labelText.toLowerCase()}.`, "POS_OUTLET_LOCATION_INVALID");
  return id;
}

// The GST registration: the company's own and active; when both say which state they are in, the same state as the outlet.
async function checkRegistration(client, c, registrationId, stateCode) {
  const id = optionalId(registrationId, "GST registration");
  if (!id) return null;
  const registration = (await client.query(`SELECT status, state_code, code FROM tenant.tax_registrations WHERE organization_id = $1 AND id = $2`, [c.organizationId, id])).rows[0];
  if (!registration) throw issue("taxRegistrationId", "Choose a GST registration of the company.", "POS_OUTLET_TAX_INVALID");
  if (registration.status !== "active") throw issue("taxRegistrationId", `${registration.code} is inactive. Choose an active GST registration.`, "POS_OUTLET_TAX_INVALID");
  if (stateCode && registration.state_code && String(registration.state_code).trim() !== String(stateCode).trim())
    throw issue("taxRegistrationId", `${registration.code} is registered in state ${registration.state_code}, but the outlet is in state ${stateCode}. Choose the registration for the outlet's state.`, "POS_OUTLET_TAX_INVALID");
  return id;
}

async function checkPriceList(client, c, priceListId) {
  const id = optionalId(priceListId, "Price list");
  if (!id) return null;
  if (!(await client.query(`SELECT 1 FROM tenant.price_lists WHERE organization_id = $1 AND id = $2 AND price_list_type = 'sales' AND status = 'active'`, [c.organizationId, id])).rows[0])
    throw issue("priceListId", "Choose an active sales price list.", "POS_OUTLET_PRICE_LIST_INVALID");
  return id;
}

async function checkCustomer(client, c, customerId) {
  const id = optionalId(customerId, "Walk-in customer");
  if (!id) return null;
  if (!(await client.query(`SELECT 1 FROM tenant.business_parties party WHERE party.organization_id = $1 AND party.id = $2 AND party.status = 'active'
      AND (party.customer_number IS NOT NULL OR party.party_type IN ('customer', 'both'))`, [c.organizationId, id])).rows[0])
    throw issue("defaultCustomerId", "Choose an active customer.", "POS_OUTLET_CUSTOMER_INVALID");
  return id;
}

const ACCOUNT_TYPES = Object.freeze({ cash: ["cash"], other: ["bank", "cash", "current_asset"] });
async function checkAccount(client, c, accountId, kind, field) {
  const id = optionalId(accountId, "Account");
  if (!id) return null;
  const account = (await client.query(`SELECT account_type, is_group, status, code FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = $2`, [c.organizationId, id])).rows[0];
  if (!account || account.is_group || account.status !== "active") throw issue(field, "Choose an active posting account of the company's chart.", "POS_OUTLET_ACCOUNT_INVALID");
  if (!ACCOUNT_TYPES[kind].includes(account.account_type))
    throw issue(field, kind === "cash" ? `${account.code} is not a cash account. Choose a cash account.` : `${account.code} is not a bank, cash or current-asset account. Choose a clearing account.`, "POS_OUTLET_ACCOUNT_INVALID");
  return id;
}

// No new selling warehouse while a session is open: the stock source of every sale in it must stay the same.
async function assertNoOpenSession(client, c, outletId, what) {
  const open = (await client.query(`SELECT count(*)::int AS count FROM tenant.pos_shifts WHERE organization_id = $1 AND store_id = $2 AND status IN ('open', 'closing')`,
    [c.organizationId, outletId])).rows[0].count;
  if (open > 0) throw issue("warehouseId", `Close the ${plural(open, "open POS session")} at this outlet before changing ${what}.`, "POS_OUTLET_OPEN_SESSION", 409);
}

async function guarded(client, run) {
  await client.query("SAVEPOINT outlet_write");
  try { const result = await run(); await client.query("RELEASE SAVEPOINT outlet_write"); return result; } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT outlet_write");
    if (error?.code === "23505" && /code/.test(error.constraint ?? "")) throw issue("code", "Another outlet with this code was just saved. Reload and try again.", "POS_OUTLET_DUPLICATE", 409);
    if (error?.code === "23514" && error.constraint === "pos_stores_location_in_warehouse") throw issue("sellingLocationId", error.message, "POS_OUTLET_LOCATION_INVALID", 409);
    throw error;
  }
}

// input: { code, name, type, address: { line1, line2, city, state, stateCode, postalCode, countryCode }, timezone, managerUserId, phone, email,
// warehouseId, sellingLocationId, returnsLocationId, taxRegistrationId, priceListId, defaultCustomerId, cashAccountId, receiptMessage,
// businessHours, notes }. Saved Inactive, accepting cash; activate it once setup is complete.
export async function createOutlet(client, c, input = {}) {
  require(c, P.create, "You do not have permission to create stores and outlets.");
  const code = normalizeOutletCode(input.code);
  const values = readOutlet(input);
  validateOutletValues(values);
  await checkCode(client, c, code);
  const warehouseId = await checkWarehouse(client, c, input.warehouseId);
  const sellingLocationId = await checkLocation(client, c, input.sellingLocationId, warehouseId, "sellingLocationId", "Selling location");
  const returnsLocationId = await checkLocation(client, c, input.returnsLocationId, warehouseId, "returnsLocationId", "Returns location");
  const managerId = await memberOrFail(client, c, input.managerUserId, "managerUserId");
  const registrationId = await checkRegistration(client, c, input.taxRegistrationId, values.stateCode);
  const priceListId = await checkPriceList(client, c, input.priceListId);
  const customerId = null;
  if (input.cashAccountId) require(c, P.managePayments, "You do not have permission to choose the cash account of an outlet.");
  const cashAccountId = await checkAccount(client, c, input.cashAccountId, "cash", "cashAccountId");
  const organization = (await client.query(`SELECT timezone, base_currency, country_code FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0] ?? {};
  const id = await guarded(client, async () => (await client.query(
    `INSERT INTO tenant.pos_stores (organization_id, code, name, outlet_type, address_line1, address_line2, city, state, state_code, postal_code, country_code, timezone,
       currency_code, manager_user_id, phone, email, warehouse_id, selling_location_id, returns_location_id, tax_registration_id, price_list_id, default_customer_id,
       cash_account_id, receipt_message, business_hours, notes, active, allowed_payment_methods, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, false, ARRAY['cash'], $27, $27) RETURNING id`,
    [c.organizationId, code, values.name, values.type, values.line1, values.line2, values.city, values.state, values.stateCode, values.postalCode,
      values.countryCode ?? organization.country_code ?? "IN", values.timezone ?? organization.timezone ?? "Asia/Kolkata", organization.base_currency ?? "INR",
      managerId, values.phone, values.email, warehouseId, sellingLocationId, returnsLocationId, registrationId, priceListId, customerId, cashAccountId,
      values.receiptMessage, JSON.stringify(values.businessHours), values.notes, c.userId ?? null])).rows[0].id);
  await client.query(`INSERT INTO tenant.pos_store_payment_methods (organization_id, store_id, method, enabled, created_by, updated_by) VALUES ($1, $2, 'cash', true, $3, $3)`,
    [c.organizationId, id, c.userId ?? null]);
  await history(client, c, id, "created", `Outlet ${code} created (inactive until activated)`, { code, name: values.name });
  return getOutlet(client, c, id);
}

// The groups of fields and who may change them: inventory defaults, tax and receipt, the cash account; everything else is Edit.
const INVENTORY = ["warehouse_id", "selling_location_id", "returns_location_id"];
const TAX = ["tax_registration_id", "receipt_message"];
const ADDRESS = ["address_line1", "address_line2", "city", "state", "state_code", "postal_code", "country_code"];

// input: any field of createOutlet, expectedVersion, reason. New sales use the new values; completed sales, returns and receipts keep theirs.
export async function updateOutlet(client, c, outletId, input = {}) {
  require(c, P.view, "You do not have permission to view stores and outlets.");
  const row = await loadOutlet(client, c, outletId, { lock: true });
  if (has(input, "expectedVersion") && input.expectedVersion !== null && input.expectedVersion !== undefined && Number(input.expectedVersion) !== Number(row.version))
    throw new PosOutletError(409, "Someone else changed this outlet after you opened it. Reload it.", "POS_OUTLET_VERSION_CONFLICT");
  const values = readOutlet(input, row);
  validateOutletValues(values);
  const code = has(input, "code") ? normalizeOutletCode(input.code) : row.code;
  if (code !== row.code) await checkCode(client, c, code, row.id);
  const warehouseId = has(input, "warehouseId") ? await checkWarehouse(client, c, input.warehouseId) : row.warehouse_id;
  // A new warehouse clears locations that belonged to the old one, unless new ones are given.
  const location = async (key, column, field, labelText) => {
    if (has(input, key)) return checkLocation(client, c, input[key], warehouseId, field, labelText);
    if (warehouseId !== row.warehouse_id) return null;
    return row[column];
  };
  const next = {
    code, name: values.name, outlet_type: values.type, address_line1: values.line1, address_line2: values.line2, city: values.city, state: values.state,
    state_code: values.stateCode, postal_code: values.postalCode, country_code: values.countryCode, timezone: values.timezone ?? row.timezone,
    manager_user_id: has(input, "managerUserId") ? await memberOrFail(client, c, input.managerUserId, "managerUserId") : row.manager_user_id,
    phone: values.phone, email: values.email, warehouse_id: warehouseId,
    selling_location_id: await location("sellingLocationId", "selling_location_id", "sellingLocationId", "Selling location"),
    returns_location_id: await location("returnsLocationId", "returns_location_id", "returnsLocationId", "Returns location"),
    tax_registration_id: has(input, "taxRegistrationId") ? await checkRegistration(client, c, input.taxRegistrationId, values.stateCode) : row.tax_registration_id,
    price_list_id: has(input, "priceListId") ? await checkPriceList(client, c, input.priceListId) : row.price_list_id,
    default_customer_id: null,
    allow_walk_in_sales: has(input, "allowWalkInSales") ? input.allowWalkInSales !== false : row.allow_walk_in_sales,
    allow_optional_buyer_name: has(input, "allowOptionalBuyerName") ? input.allowOptionalBuyerName !== false : row.allow_optional_buyer_name,
    allow_receipt_contact_capture: has(input, "allowReceiptContactCapture") ? input.allowReceiptContactCapture !== false : row.allow_receipt_contact_capture,
    cash_account_id: has(input, "cashAccountId") ? await checkAccount(client, c, input.cashAccountId, "cash", "cashAccountId") : row.cash_account_id,
    receipt_message: values.receiptMessage, business_hours: values.businessHours, notes: values.notes,
  };
  // A registration kept from before must still match a changed state.
  if (!has(input, "taxRegistrationId") && next.tax_registration_id && next.state_code !== row.state_code) await checkRegistration(client, c, next.tax_registration_id, next.state_code);
  const same = (a, b) => (typeof a === "object" && a !== null ? JSON.stringify(a) === JSON.stringify(b ?? {}) : String(a ?? "") === String(b ?? ""));
  const changed = Object.keys(next).filter((column) => !same(next[column], row[column]));
  if (!changed.length) return getOutlet(client, c, row.id);
  // Who may change what.
  if (changed.some((column) => INVENTORY.includes(column))) require(c, P.manageInventory, "You do not have permission to change the selling warehouse or locations of an outlet.");
  if (changed.some((column) => TAX.includes(column))) require(c, P.manageTax, "You do not have permission to change the GST registration or receipt of an outlet.");
  if (changed.includes("cash_account_id")) require(c, P.managePayments, "You do not have permission to change the cash account of an outlet.");
  if (changed.some((column) => !INVENTORY.includes(column) && !TAX.includes(column) && column !== "cash_account_id")) require(c, P.edit, "You do not have permission to edit stores and outlets.");
  if (changed.includes("warehouse_id")) await assertNoOpenSession(client, c, row.id, "the selling warehouse");
  // A deactivated warehouse, registration or list cannot stay on an active outlet unnoticed: the checks above refuse inactive picks.
  await guarded(client, () => client.query(
    `UPDATE tenant.pos_stores SET ${changed.map((column, index) => `${column} = $${index + 3}`).join(", ")}, version = version + 1, updated_by = $${changed.length + 3}, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, ...changed.map((column) => (column === "business_hours" ? JSON.stringify(next[column]) : next[column])), c.userId ?? null]));
  // Terminals sell from the outlet's warehouse: a terminal's selling location in the old warehouse no longer applies.
  if (changed.includes("warehouse_id")) {
    const cleared = (await client.query(
      `UPDATE tenant.pos_terminals terminal SET selling_location_id = NULL, version = version + 1, updated_by = $3, updated_at = now()
        WHERE terminal.organization_id = $1 AND terminal.store_id = $2 AND terminal.selling_location_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM tenant.warehouse_locations location WHERE location.organization_id = terminal.organization_id AND location.id = terminal.selling_location_id
                            AND location.warehouse_id = $4)
        RETURNING terminal.id`, [c.organizationId, row.id, c.userId ?? null, next.warehouse_id])).rows;
    for (const terminal of cleared)
      await client.query(`INSERT INTO tenant.pos_terminal_history (organization_id, terminal_id, event_type, summary, actor_user_id) VALUES ($1, $2, 'location_changed', $3, $4)`,
        [c.organizationId, terminal.id, "Selling location cleared: the outlet now sells from another warehouse", c.userId ?? null]);
  }
  const diff = (columns) => Object.fromEntries(columns.filter((column) => changed.includes(column)).map((column) => [column, { from: row[column] ?? null, to: next[column] ?? null }]));
  const reason = text(input.reason, 300);
  if (changed.includes("code")) await history(client, c, row.id, "code_changed", `Code changed from ${row.code} to ${code}`, diff(["code"]), reason);
  if (changed.some((column) => ADDRESS.includes(column))) await history(client, c, row.id, "address_changed", "Address changed (new receipts use it; issued receipts keep theirs)", diff(ADDRESS), reason);
  if (changed.includes("manager_user_id")) await history(client, c, row.id, "manager_changed", "Manager changed", diff(["manager_user_id"]), reason);
  if (changed.some((column) => INVENTORY.includes(column))) await history(client, c, row.id, "inventory_changed", changed.includes("warehouse_id")
    ? "Selling warehouse changed (new sales take stock from it; completed sales keep theirs)" : "Selling or returns location changed", diff(INVENTORY), reason);
  if (changed.includes("tax_registration_id")) await history(client, c, row.id, "tax_changed", "GST registration changed (new receipts use it; issued tax documents keep theirs)", diff(["tax_registration_id"]), reason);
  if (changed.includes("price_list_id")) await history(client, c, row.id, "price_list_changed", "Default price list changed (new carts use it)", diff(["price_list_id"]), reason);
  const covered = ["code", "manager_user_id", "tax_registration_id", "price_list_id", ...ADDRESS, ...INVENTORY];
  const other = changed.filter((column) => !covered.includes(column));
  if (other.length) await history(client, c, row.id, "updated", `${other.map((column) => column.replace(/_id$/, "").replace(/_/g, " ")).join(", ")} changed`, diff(other), reason);
  return getOutlet(client, c, row.id);
}

// ------------------------------------------------------------------ setup check, activation, deactivation, deletion

async function setupIssues(client, c, row) {
  const issues = [];
  const add = (code, field, message) => issues.push({ code, field, message });
  for (const [column, labelText] of [["address_line1", "address line"], ["city", "city"], ["state", "state"], ["postal_code", "postal code"], ["country_code", "country"]])
    if (!row[column]) add("ADDRESS", column, `Enter the ${labelText}.`);
  if (!row.timezone) add("TIMEZONE", "timezone", "Choose the outlet's time zone.");
  if (row.warehouse_status !== "active") add("WAREHOUSE", "warehouseId", `The selling warehouse ${row.warehouse_code ?? ""} is inactive. Choose an active warehouse.`.replace("  ", " "));
  const registrations = n((await client.query(`SELECT count(*)::int AS count FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active'`, [c.organizationId])).rows[0].count);
  if (!row.tax_registration_id && registrations > 0) add("TAX", "taxRegistrationId", "Choose the GST registration the outlet sells under.");
  if (row.tax_registration_id && row.registration_status !== "active") add("TAX", "taxRegistrationId", "The GST registration is inactive. Choose an active one.");
  if (row.tax_registration_id && row.registration_state_code && row.state_code && String(row.registration_state_code).trim() !== String(row.state_code).trim())
    add("TAX", "taxRegistrationId", `The GST registration is for state ${row.registration_state_code}, but the outlet is in state ${row.state_code}.`);
  const methods = n((await client.query(`SELECT count(*)::int AS count FROM tenant.pos_store_payment_methods WHERE organization_id = $1 AND store_id = $2 AND enabled`,
    [c.organizationId, row.id])).rows[0].count);
  if (methods === 0) add("PAYMENTS", "paymentMethods", "Enable at least one payment method.");
  return issues;
}

// What is missing before the outlet can be activated ([] when it is ready).
export async function validateOutletSetup(client, c, outletId) {
  require(c, P.view, "You do not have permission to view stores and outlets.");
  const row = await loadOutlet(client, c, outletId);
  await assertVisible(client, c, row.id);
  return setupIssues(client, c, row);
}

// What stands between an active outlet and Inactive ([] when it can be deactivated). Stock does not: the warehouse keeps it.
export async function validateOutletForDeactivation(client, c, outletId) {
  require(c, P.view, "You do not have permission to view stores and outlets.");
  const row = await loadOutlet(client, c, outletId);
  const count = async (sql) => n((await client.query(sql, [c.organizationId, row.id])).rows[0].count);
  const blockers = [];
  for (const [code, word, message, sql] of [
    ["OPEN_SESSIONS", "open POS session", "Close the active POS sessions before deactivating this outlet.", `SELECT count(*)::int AS count FROM tenant.pos_shifts WHERE organization_id = $1 AND store_id = $2 AND status IN ('open', 'closing')`],
    ["ACTIVE_CARTS", "open or held cart", "Complete or cancel them first.", `SELECT count(*)::int AS count FROM tenant.pos_carts WHERE organization_id = $1 AND store_id = $2 AND status IN ('draft', 'priced', 'held')`],
    ["ACTIVE_TERMINALS", "active terminal", "Deactivate the outlet's terminals first.", `SELECT count(*)::int AS count FROM tenant.pos_terminals WHERE organization_id = $1 AND store_id = $2 AND status = 'active'`],
    ["RECONCILIATIONS", "unresolved payment reconciliation", "Resolve them first.", `SELECT count(*)::int AS count FROM tenant.pos_reconciliations WHERE organization_id = $1 AND store_id = $2 AND status IN ('draft', 'variance')`],
    ["POSTING_FAILURES", "sale or return that failed to post to accounting", "Retry the posting first.", `SELECT (SELECT count(*) FROM tenant.pos_sales WHERE organization_id = $1 AND store_id = $2 AND accounting_posting_status = 'failed')
       + (SELECT count(*) FROM tenant.pos_returns WHERE organization_id = $1 AND store_id = $2 AND accounting_posting_status = 'failed') AS count`],
  ]) {
    const found = await count(sql);
    if (found > 0) blockers.push({ code, count: found, message: `${plural(found, word)}. ${message}` });
  }
  return blockers;
}

// Activate: only when setup is complete. Deactivate: only when nothing operational is open there. History stays either way.
export async function setOutletStatus(client, c, outletId, status, input = {}) {
  require(c, P.status, "You do not have permission to activate or deactivate stores and outlets.");
  if (!["active", "inactive"].includes(status)) throw issue("status", "Choose Active or Inactive.");
  const row = await loadOutlet(client, c, outletId, { lock: true });
  if ((row.active ? "active" : "inactive") === status) throw new PosOutletError(409, `This outlet is already ${status}.`, "POS_OUTLET_STATUS_UNCHANGED");
  const reason = text(input.reason, 300);
  if (status === "active") {
    const missing = await setupIssues(client, c, row);
    if (missing.length) throw new PosOutletError(409, `This outlet cannot be activated yet. ${missing.map((entry) => entry.message).join(" ")}`, "POS_OUTLET_SETUP_INCOMPLETE", { issues: missing });
  } else {
    const blockers = await validateOutletForDeactivation(client, c, row.id);
    if (blockers.length) throw new PosOutletError(409, `This outlet cannot be deactivated. ${blockers.map((entry) => entry.message).join(" ")}`, "POS_OUTLET_BUSY", { blockers });
  }
  await client.query(`UPDATE tenant.pos_stores SET active = $3, version = version + 1, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, status === "active", c.userId ?? null]);
  await history(client, c, row.id, status === "active" ? "activated" : "deactivated", status === "active" ? "Activated" : "Deactivated", { from: row.active ? "active" : "inactive", to: status }, reason);
  return getOutlet(client, c, row.id);
}

// Only an outlet nothing has ever used can be deleted (with its payment methods, access and history); anything else is deactivated.
export async function deleteOutlet(client, c, outletId) {
  require(c, P.status, "You do not have permission to delete stores and outlets.");
  const row = await loadOutlet(client, c, outletId, { lock: true });
  const references = [
    ["terminals", "pos_terminals"], ["sessions", "pos_shifts"], ["carts", "pos_carts"], ["sales", "pos_sales"], ["returns", "pos_returns"], ["payments", "pos_payments"],
    ["day-end reports", "pos_day_end_reports"], ["reconciliations", "pos_reconciliations"], ["settlement batches", "pos_settlement_batches"],
  ];
  const used = [];
  for (const [labelText, table] of references)
    if ((await client.query(`SELECT 1 FROM tenant.${table} WHERE organization_id = $1 AND store_id = $2 LIMIT 1`, [c.organizationId, row.id])).rows[0]) used.push(labelText);
  if (used.length) throw new PosOutletError(409, `This outlet has ${used.join(", ")}. Deactivate it instead.`, "POS_OUTLET_IN_USE", { references: used });
  await client.query(`DELETE FROM tenant.pos_payment_provider_configs WHERE organization_id = $1 AND store_id = $2`, [c.organizationId, row.id]);
  await client.query(`DELETE FROM tenant.pos_stores WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id]);
  return { deleted: true };
}

// ------------------------------------------------------------------ payment methods

export async function getOutletPaymentMethods(client, c, outletId) {
  require(c, P.view, "You do not have permission to view stores and outlets.");
  const finance = can(c, P.viewFinance);
  const { rows } = await client.query(
    `SELECT method.method, method.enabled, method.account_id, account.code AS account_code, account.name AS account_name, provider.provider_key
       FROM tenant.pos_store_payment_methods method
       LEFT JOIN tenant.accounting_accounts account ON account.organization_id = method.organization_id AND account.id = method.account_id
       LEFT JOIN tenant.pos_payment_provider_configs provider ON provider.organization_id = method.organization_id AND provider.store_id = method.store_id
             AND provider.payment_method = method.method AND provider.active
      WHERE method.organization_id = $1 AND method.store_id = $2`, [c.organizationId, uuid(outletId, "Outlet")]);
  const byMethod = new Map(rows.map((row) => [row.method, row]));
  return OUTLET_PAYMENT_METHODS.map(({ code, label: methodLabel }) => {
    const row = byMethod.get(code);
    return {
      method: code, label: methodLabel, enabled: Boolean(row?.enabled), providerKey: code === "cash" ? null : row?.provider_key ?? null,
      accountId: finance ? row?.account_id ?? null : null, account: finance ? label(row?.account_code, row?.account_name) : null,
    };
  });
}

// methods: [{ method, enabled, accountId?, providerKey? }] — the methods the outlet accepts and, for each, its cash or clearing account and
// (card, UPI, wallet, bank transfer) the payment provider that takes it. A method left out keeps its setting.
export async function configureOutletPaymentMethods(client, c, outletId, methods = []) {
  require(c, P.managePayments, "You do not have permission to manage the payment methods of an outlet.");
  const row = await loadOutlet(client, c, outletId, { lock: true });
  const before = await getOutletPaymentMethods(client, c, row.id);
  const providers = registeredPaymentProviderKeys();
  for (const entry of Array.isArray(methods) ? methods : []) {
    const method = String(entry?.method ?? "").trim().toLowerCase();
    if (!METHOD_CODES.includes(method)) throw issue("method", `"${method}" is not a payment method an outlet can accept.`, "POS_OUTLET_PAYMENT_INVALID");
    const enabled = entry.enabled === true;
    const accountId = has(entry, "accountId") ? await checkAccount(client, c, entry.accountId, method === "cash" ? "cash" : "other", `${method}.accountId`) : undefined;
    await client.query(
      `INSERT INTO tenant.pos_store_payment_methods (organization_id, store_id, method, enabled, account_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       ON CONFLICT (organization_id, store_id, method) DO UPDATE SET enabled = EXCLUDED.enabled,
         account_id = CASE WHEN $7 THEN EXCLUDED.account_id ELSE tenant.pos_store_payment_methods.account_id END, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [c.organizationId, row.id, method, enabled, accountId ?? null, c.userId ?? null, accountId !== undefined]);
    if (method === "cash") continue;
    // A card, UPI, wallet or bank-transfer payment is taken through a provider; switching the method off switches its provider off.
    if (enabled) {
      const providerKey = String(entry.providerKey || "sandbox").trim().toLowerCase();
      if (!providers.includes(providerKey)) throw issue(`${method}.providerKey`, `Payment provider "${providerKey}" is not available. Available: ${providers.join(", ")}.`, "POS_OUTLET_PAYMENT_INVALID");
      await client.query(
        `INSERT INTO tenant.pos_payment_provider_configs (organization_id, store_id, payment_method, provider_key, active, created_by) VALUES ($1, $2, $3, $4, true, $5)
         ON CONFLICT (organization_id, store_id, payment_method) DO UPDATE SET provider_key = EXCLUDED.provider_key, active = true, updated_at = now()`,
        [c.organizationId, row.id, method, providerKey, c.userId ?? null]);
    } else {
      await client.query(`UPDATE tenant.pos_payment_provider_configs SET active = false, updated_at = now() WHERE organization_id = $1 AND store_id = $2 AND payment_method = $3`,
        [c.organizationId, row.id, method]);
    }
  }
  const after = await getOutletPaymentMethods(client, c, row.id);
  const summary = (list) => list.filter((entry) => entry.enabled).map((entry) => entry.method);
  const accounts = (list) => Object.fromEntries(list.map((entry) => [entry.method, entry.accountId]));
  if (JSON.stringify(summary(before)) !== JSON.stringify(summary(after)) || JSON.stringify(accounts(before)) !== JSON.stringify(accounts(after)))
    await history(client, c, row.id, "payment_methods_changed", `Payment methods: ${summary(after).join(", ") || "none"}`,
      { from: summary(before), to: summary(after), accounts: { from: accounts(before), to: accounts(after) } });
  await client.query(`UPDATE tenant.pos_stores SET version = version + 1, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, c.userId ?? null]);
  return after;
}

// Is this payment method enabled at the outlet? Checkout asks before taking a payment.
export async function isOutletPaymentMethodEnabled(client, organizationId, outletId, method) {
  return Boolean((await client.query(`SELECT 1 FROM tenant.pos_store_payment_methods WHERE organization_id = $1 AND store_id = $2 AND method = $3 AND enabled`,
    [organizationId, outletId, method])).rows[0]);
}

// ------------------------------------------------------------------ users and cashiers

// The cashiers who may work at the outlet, with what their roles let them do at a POS. Access is given to a cashier under Cashiers.
export async function getOutletAccess(client, c, outletId) {
  require(c, P.view, "You do not have permission to view stores and outlets.");
  return listOutletCashiers(client, c, outletId);
}

// ------------------------------------------------------------------ tabs read from their own domains

// The outlet's stock context, read from Inventory: its warehouse and locations and the warehouse's on hand, reserved, restricted and
// available stock. Value only for those who may see stock value.
export async function getOutletInventorySummary(client, c, outletId) {
  require(c, P.view, "You do not have permission to view stores and outlets.");
  const row = await loadOutlet(client, c, outletId);
  await assertVisible(client, c, row.id);
  const showValue = can(c, "warehouses.view_value") || can(c, "stock.valuation.view");
  const figures = (await client.query(
    `SELECT COALESCE(sum(balance.quantity), 0) AS on_hand, COALESCE(sum(balance.reserved_quantity), 0) AS reserved,
            COALESCE(sum(CASE WHEN ${restrictedStockSql("location", "batch")} THEN balance.quantity ELSE 0 END), 0) AS restricted,
            COALESCE(sum(balance.quantity * balance.average_cost), 0) AS value, count(DISTINCT balance.item_id) FILTER (WHERE balance.quantity <> 0) AS items
       FROM tenant.stock_balances balance
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
      WHERE balance.organization_id = $1 AND balance.warehouse_id = $2`, [c.organizationId, row.warehouse_id])).rows[0];
  const sharedWith = (await client.query(`SELECT code, name FROM tenant.pos_stores WHERE organization_id = $1 AND warehouse_id = $2 AND id <> $3 ORDER BY code`,
    [c.organizationId, row.warehouse_id, row.id])).rows;
  return {
    warehouseId: row.warehouse_id, warehouse: label(row.warehouse_code, row.warehouse_name), warehouseActive: row.warehouse_status === "active",
    sellingLocationId: row.selling_location_id, sellingLocation: label(row.selling_location_code, row.selling_location_name),
    returnsLocationId: row.returns_location_id, returnsLocation: label(row.returns_location_code, row.returns_location_name),
    stock: {
      onHand: round(figures.on_hand), reserved: round(figures.reserved), restricted: round(figures.restricted),
      available: round(n(figures.on_hand) - n(figures.reserved) - n(figures.restricted)), items: n(figures.items), ...(showValue ? { value: round(figures.value) } : {}),
    },
    showsValue: showValue, sharedWith: sharedWith.map((outlet) => `${outlet.code} · ${outlet.name}`),
  };
}

export async function getOutletTerminals(client, c, outletId) {
  require(c, P.view, "You do not have permission to view stores and outlets.");
  const id = uuid(outletId, "Outlet");
  await assertVisible(client, c, id);
  const { rows } = await client.query(
    `SELECT terminal.id, terminal.code, terminal.name, terminal.status, terminal.receipt_prefix, shift.id AS shift_id, shift.shift_number, cashier.full_name AS cashier_name,
            GREATEST(terminal.updated_at, shift.opened_at, (SELECT max(sale.completed_at) FROM tenant.pos_sales sale WHERE sale.organization_id = terminal.organization_id AND sale.terminal_id = terminal.id)) AS last_activity
       FROM tenant.pos_terminals terminal
       LEFT JOIN LATERAL (SELECT * FROM tenant.pos_shifts open_shift WHERE open_shift.organization_id = terminal.organization_id AND open_shift.terminal_id = terminal.id
                           AND open_shift.status IN ('open', 'closing') ORDER BY open_shift.opened_at DESC NULLS LAST LIMIT 1) shift ON true
       LEFT JOIN public.users cashier ON cashier.id = shift.cashier_user_id
      WHERE terminal.organization_id = $1 AND terminal.store_id = $2 ORDER BY terminal.code`, [c.organizationId, id]);
  return rows.map((row) => ({
    id: row.id, code: row.code, name: row.name, status: row.status, receiptPrefix: row.receipt_prefix, currentSession: row.shift_number ?? null, currentSessionId: row.shift_id ?? null,
    cashier: row.cashier_name ?? null, lastActivity: row.last_activity,
  }));
}

// The outlet's sessions (shifts), newest first; the business date is the opening day in the outlet's time zone. Cash figures for those
// who may see outlet finance details.
export async function getOutletSessions(client, c, outletId, filters = {}) {
  require(c, P.viewSessions, "You do not have permission to view the sessions of an outlet.");
  const row = await loadOutlet(client, c, outletId);
  await assertVisible(client, c, row.id);
  const finance = can(c, P.viewFinance);
  const { rows } = await client.query(
    `SELECT shift.id, shift.shift_number, shift.status, shift.opened_at, shift.closed_at, shift.opening_cash, shift.counted_cash, shift.cash_variance,
            terminal.code AS terminal_code, cashier.full_name AS cashier_name, (shift.opened_at AT TIME ZONE $3)::date::text AS business_date
       FROM tenant.pos_shifts shift
       JOIN tenant.pos_terminals terminal ON terminal.organization_id = shift.organization_id AND terminal.id = shift.terminal_id
       LEFT JOIN public.users cashier ON cashier.id = shift.cashier_user_id
      WHERE shift.organization_id = $1 AND shift.store_id = $2 AND ($4::text IS NULL OR shift.status = $4)
      ORDER BY shift.opened_at DESC NULLS FIRST, shift.created_at DESC LIMIT 500`, [c.organizationId, row.id, row.timezone || "Asia/Kolkata", text(filters.status)]);
  return rows.map((session) => ({
    id: session.id, number: session.shift_number, status: session.status, terminal: session.terminal_code, cashier: session.cashier_name, businessDate: session.business_date,
    openedAt: session.opened_at, closedAt: session.closed_at,
    ...(finance ? { openingCash: round(session.opening_cash), closingCash: session.counted_cash === null ? null : round(session.counted_cash),
      difference: session.cash_variance === null ? null : round(session.cash_variance) } : {}),
  }));
}

// Sales and returns made at the outlet, newest first.
export async function getOutletTransactions(client, c, outletId, filters = {}) {
  require(c, P.viewTransactions, "You do not have permission to view the transactions of an outlet.");
  const row = await loadOutlet(client, c, outletId);
  await assertVisible(client, c, row.id);
  const term = text(filters.search);
  const { rows } = await client.query(
    `SELECT * FROM (
       SELECT sale.id, 'sale' AS kind, sale.receipt_number AS number, sale.completed_at AS at, terminal.code AS terminal_code, cashier.full_name AS cashier_name,
              COALESCE(sale.customer_name, customer.display_name) AS customer_name, sale.grand_total AS amount, sale.status,
              (SELECT string_agg(DISTINCT payment.payment_method, ', ') FROM tenant.pos_payments payment WHERE payment.organization_id = sale.organization_id AND payment.cart_id = sale.cart_id) AS payment
         FROM tenant.pos_sales sale
         JOIN tenant.pos_terminals terminal ON terminal.organization_id = sale.organization_id AND terminal.id = sale.terminal_id
         LEFT JOIN tenant.pos_shifts shift ON shift.organization_id = sale.organization_id AND shift.id = sale.shift_id
         LEFT JOIN public.users cashier ON cashier.id = shift.cashier_user_id
         LEFT JOIN tenant.business_parties customer ON customer.organization_id = sale.organization_id AND customer.id = sale.customer_id
        WHERE sale.organization_id = $1 AND sale.store_id = $2 AND sale.status <> 'draft'
       UNION ALL
       SELECT ret.id, 'return', ret.return_number, COALESCE(ret.completed_at, ret.created_at), terminal.code, cashier.full_name, NULL, -ret.refund_total, ret.status, NULL
         FROM tenant.pos_returns ret
         JOIN tenant.pos_terminals terminal ON terminal.organization_id = ret.organization_id AND terminal.id = ret.terminal_id
         LEFT JOIN tenant.pos_shifts shift ON shift.organization_id = ret.organization_id AND shift.id = ret.shift_id
         LEFT JOIN public.users cashier ON cashier.id = shift.cashier_user_id
        WHERE ret.organization_id = $1 AND ret.store_id = $2
     ) entry
     WHERE ($3::text IS NULL OR lower(concat_ws(' ', entry.number, entry.customer_name, entry.cashier_name, entry.terminal_code)) LIKE $3)
     ORDER BY entry.at DESC NULLS LAST LIMIT 500`, [c.organizationId, row.id, term ? `%${term.toLowerCase()}%` : null]);
  return rows.map((entry) => ({
    id: entry.id, kind: entry.kind, number: entry.number, at: entry.at, terminal: entry.terminal_code, cashier: entry.cashier_name, customer: entry.customer_name,
    amount: round(entry.amount), payment: entry.payment, status: entry.status,
  }));
}

// What the outlet's documents are numbered and printed with: receipts and returns by the shared numbering service in each terminal's series,
// the seller details from the GST registration, the receipt message from the outlet.
async function outletDocuments(client, c, row) {
  const terminals = (await client.query(`SELECT code, receipt_prefix FROM tenant.pos_terminals WHERE organization_id = $1 AND store_id = $2 ORDER BY code`, [c.organizationId, row.id])).rows;
  return {
    gstin: row.registration_number ?? null, legalName: row.registration_legal_name ?? null, taxRegistration: label(row.registration_code, row.registration_name),
    receiptSeries: terminals.map((terminal) => ({ terminal: terminal.code, prefix: terminal.receipt_prefix })),
    receiptHeader: { displayName: row.name, address: [row.address_line1, row.address_line2, row.city, row.state, row.postal_code].filter(Boolean).join(", "), phone: row.phone, email: row.email },
    receiptMessage: row.receipt_message,
  };
}

export async function getOutletHistory(client, c, outletId) {
  require(c, P.view, "You do not have permission to view stores and outlets.");
  const { rows } = await client.query(
    `SELECT history.*, actor.full_name AS actor_name FROM tenant.pos_store_history history LEFT JOIN public.users actor ON actor.id = history.actor_user_id
      WHERE history.organization_id = $1 AND history.store_id = $2 ORDER BY history.created_at DESC, history.id DESC LIMIT 300`, [c.organizationId, uuid(outletId, "Outlet")]);
  return rows.map((row) => ({ id: row.id, eventType: row.event_type, summary: row.summary, changes: row.changes, reason: row.reason, actorName: row.actor_name, createdAt: row.created_at }));
}

// What the outlet screens need to draw their forms and filters.
export async function getOutletOptions(client, c) {
  require(c, P.view, "You do not have permission to view stores and outlets.");
  const one = (sql, values = [c.organizationId]) => client.query(sql, values).then((result) => result.rows);
  // One after another: a single transaction client runs one query at a time.
  const members = await one(`SELECT users.id, users.full_name FROM public.organization_memberships membership JOIN public.users users ON users.id = membership.user_id
    WHERE membership.organization_id = $1 AND membership.status = 'active' ORDER BY users.full_name LIMIT 1000`);
  const warehouses = await one(`SELECT id, code, name FROM tenant.warehouses WHERE organization_id = $1 AND status = 'active' AND COALESCE(warehouse_type, 'stores') <> 'transit' ORDER BY code`);
  const locations = await one(`SELECT id, warehouse_id, code, name, purpose FROM tenant.warehouse_locations WHERE organization_id = $1 AND status = 'active' AND allow_stock ORDER BY code`);
  const registrations = await one(`SELECT id, code, name, state_code, registration_number FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active' ORDER BY is_default DESC, code`);
  const priceLists = await one(`SELECT id, code, name FROM tenant.price_lists WHERE organization_id = $1 AND price_list_type = 'sales' AND status = 'active' ORDER BY is_default DESC, lower(name)`);
  const customers = await one(`SELECT id, display_name AS name, customer_number FROM tenant.business_parties party WHERE party.organization_id = $1 AND party.status = 'active'
    AND (party.customer_number IS NOT NULL OR party.party_type IN ('customer', 'both')) ORDER BY lower(display_name) LIMIT 1000`);
  const accounts = can(c, P.viewFinance) || can(c, P.managePayments)
    ? await one(`SELECT id, code, name, account_type FROM tenant.accounting_accounts WHERE organization_id = $1 AND status = 'active' AND NOT is_group
        AND account_type IN ('cash', 'bank', 'current_asset') ORDER BY code`)
    : [];
  const organization = await one(`SELECT timezone, country_code, base_currency FROM public.organizations WHERE id = $1`);
  const outlets = await one(`SELECT DISTINCT state, city FROM tenant.pos_stores WHERE organization_id = $1 AND (state IS NOT NULL OR city IS NOT NULL)`);
  const unique = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    types: OUTLET_TYPES, paymentMethods: OUTLET_PAYMENT_METHODS, weekdays: WEEKDAYS, providers: registeredPaymentProviderKeys(),
    members: members.map((row) => ({ id: row.id, name: row.full_name })),
    warehouses: warehouses.map((row) => ({ id: row.id, label: `${row.code} · ${row.name}` })),
    locations: locations.map((row) => ({ id: row.id, warehouseId: row.warehouse_id, label: `${row.code} · ${row.name}`, purpose: row.purpose })),
    registrations: registrations.map((row) => ({ id: row.id, label: `${row.code} · ${row.name}`, stateCode: row.state_code, gstin: row.registration_number })),
    priceLists: priceLists.map((row) => ({ id: row.id, label: `${row.code} · ${row.name}` })),
    customers: customers.map((row) => ({ id: row.id, label: row.customer_number ? `${row.customer_number} · ${row.name}` : row.name })),
    accounts: accounts.map((row) => ({ id: row.id, label: `${row.code} · ${row.name}`, type: row.account_type })),
    states: unique(outlets.map((row) => row.state)), cities: unique(outlets.map((row) => row.city)),
    defaults: { timezone: organization[0]?.timezone ?? "Asia/Kolkata", countryCode: organization[0]?.country_code ?? "IN", currencyCode: organization[0]?.base_currency?.trim() ?? "INR" },
    capabilities: outletCapabilities(c),
  };
}
