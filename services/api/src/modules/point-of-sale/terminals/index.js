// POS Terminals: one logical checkout register inside an outlet (tenant.pos_terminals). The terminal is the register's business identity —
// not a computer, warehouse, cashier, session, stock balance or cash ledger. Its company is its outlet's; the cashier working on it, its
// open session and its last activity are read from the sessions and sales, never stored on it.
//
// - Inheritance: the selling warehouse, returns location, price list, GST registration, walk-in customer, time zone and currency are the
//   outlet's. A terminal may override only its selling location (inside the outlet's warehouse), its cash account, a subset of the outlet's
//   payment methods, its payment device and its receipt series. getEffectiveTerminalConfiguration() resolves the chain for checkout.
// - Lifecycle: Active / Inactive. Operating it needs an active terminal, an active outlet, outlet access and an open session (one per
//   terminal, enforced by pos_terminal_open_shift_uidx). Deactivation waits for its session to close; a used terminal is never deleted,
//   never moves to another outlet and keeps its code.
// - Posting-critical settings (outlet, selling location, cash, payment methods and device, receipt series) are locked while a session is open.
import { POS_TERMINAL_PERMISSIONS as P } from "@vercentlabs/permissions";

import { OUTLET_PAYMENT_METHODS } from "../outlets/index.js";
import { assertPosStoreAccess } from "../shared/access-control.js";

export class PosTerminalError extends Error {
  constructor(status, message, code = "POS_TERMINAL_ERROR", details = undefined) {
    super(message);
    this.name = "PosTerminalError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const CODE = /^[A-Z0-9][A-Z0-9._/-]{0,29}$/;
const PREFIX = /^[A-Z0-9][A-Z0-9/_-]{0,23}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METHOD_CODES = OUTLET_PAYMENT_METHODS.map((entry) => entry.code);
const METHOD_LABEL = Object.fromEntries(OUTLET_PAYMENT_METHODS.map((entry) => [entry.code, entry.label]));
const OPEN_SESSION = "('open', 'closing')";

const BYPASS_ROLES = ["organization_owner", "system_administrator"];
const can = (c, permission) => Boolean(c.roleSlugs?.some((slug) => BYPASS_ROLES.includes(slug)) || c.permissions?.includes(permission));
const require = (c, permission, message) => { if (!can(c, permission)) throw new PosTerminalError(403, message, "PERMISSION_DENIED"); };
const text = (value, max = 500) => { const out = String(value ?? "").trim().replace(/\s+/g, " "); return out ? out.slice(0, max) : null; };
const has = (input, key) => Object.prototype.hasOwnProperty.call(input ?? {}, key);
const issue = (field, message, code = "POS_TERMINAL_VALIDATION", status = 400) => new PosTerminalError(status, message, code, { issues: [{ field, message }] });
const uuid = (value, label, code = "POS_TERMINAL_VALIDATION") => { const id = String(value ?? "").trim(); if (!UUID.test(id)) throw new PosTerminalError(400, `${label} is not valid.`, code); return id; };
const optionalId = (value, label) => (value === null || value === undefined || value === "" ? null : uuid(value, label));
const n = (value) => Number(value ?? 0);
const round = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const label = (code, name) => (code ? `${code} · ${name}` : null);
export const normalizeTerminalCode = (value) => String(value ?? "").normalize("NFKC").trim().toUpperCase();
const sanitizePrefix = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9/_-]+/g, "-").replace(/^[^A-Z0-9]+/, "").slice(0, 24);

async function history(client, c, terminalId, eventType, summary, changes = {}, reason = null) {
  await client.query(
    `INSERT INTO tenant.pos_terminal_history (organization_id, terminal_id, event_type, summary, changes, reason, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [c.organizationId, terminalId, eventType, String(summary).slice(0, 500), JSON.stringify(changes), reason, c.userId ?? null]);
}

export function terminalCapabilities(c) {
  return Object.fromEntries(Object.entries(P).map(([name, permission]) => [name, can(c, permission)]));
}

// ------------------------------------------------------------------ reading

const SELECT = `
  SELECT terminal.*, outlet.code AS outlet_code, outlet.name AS outlet_name, outlet.active AS outlet_active, outlet.warehouse_id, outlet.timezone,
         outlet.selling_location_id AS outlet_location_id, outlet.cash_account_id AS outlet_cash_account_id, outlet.currency_code,
         warehouse.code AS warehouse_code, warehouse.name AS warehouse_name,
         location.code AS location_code, location.name AS location_name, outlet_location.code AS outlet_location_code, outlet_location.name AS outlet_location_name,
         cash_account.code AS cash_account_code, cash_account.name AS cash_account_name,
         session.id AS session_id, session.shift_number AS session_number, session.status AS session_status, session.opened_at AS session_opened_at,
         session.cashier_user_id AS session_cashier_id, cashier.full_name AS session_cashier_name,
         (SELECT max(sale.completed_at) FROM tenant.pos_sales sale WHERE sale.organization_id = terminal.organization_id AND sale.terminal_id = terminal.id) AS last_sale_at,
         (SELECT min(shift.opened_at) FROM tenant.pos_shifts shift WHERE shift.organization_id = terminal.organization_id AND shift.terminal_id = terminal.id) AS first_used_at,
         (SELECT max(GREATEST(shift.opened_at, shift.closed_at)) FROM tenant.pos_shifts shift WHERE shift.organization_id = terminal.organization_id AND shift.terminal_id = terminal.id) AS last_session_at
    FROM tenant.pos_terminals terminal
    JOIN tenant.pos_stores outlet ON outlet.organization_id = terminal.organization_id AND outlet.id = terminal.store_id
    LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = outlet.organization_id AND warehouse.id = outlet.warehouse_id
    LEFT JOIN tenant.warehouse_locations location ON location.organization_id = terminal.organization_id AND location.id = terminal.selling_location_id
    LEFT JOIN tenant.warehouse_locations outlet_location ON outlet_location.organization_id = outlet.organization_id AND outlet_location.id = outlet.selling_location_id
    LEFT JOIN tenant.accounting_accounts cash_account ON cash_account.organization_id = terminal.organization_id AND cash_account.id = terminal.cash_account_id
    LEFT JOIN LATERAL (SELECT * FROM tenant.pos_shifts open_shift WHERE open_shift.organization_id = terminal.organization_id AND open_shift.terminal_id = terminal.id
                        AND open_shift.status IN ${OPEN_SESSION} ORDER BY open_shift.opened_at DESC NULLS LAST LIMIT 1) session ON true
    LEFT JOIN public.users cashier ON cashier.id = session.cashier_user_id`;

function toTerminal(row, c) {
  const finance = can(c, "pos.outlets.view_finance");
  const lastActivity = [row.last_sale_at, row.last_session_at].filter(Boolean).map((value) => new Date(value)).sort((a, b) => b - a)[0] ?? null;
  return {
    id: row.id, code: row.code, name: row.name, status: row.status === "active" ? "active" : "inactive", isActive: row.status === "active",
    outletId: row.store_id, outletCode: row.outlet_code, outlet: label(row.outlet_code, row.outlet_name), outletActive: row.outlet_active,
    // What the register can do right now: it may operate only while it and its outlet are active.
    operable: row.status === "active" && row.outlet_active,
    operationalState: row.session_id ? "session_open" : row.status === "active" && row.outlet_active ? "available" : "unavailable",
    currentSessionId: row.session_id ?? null, currentSession: row.session_number ?? null, currentCashierId: row.session_cashier_id ?? null, currentCashier: row.session_cashier_name ?? null,
    sessionOpenedAt: row.session_opened_at ?? null,
    businessDate: row.session_opened_at ? new Intl.DateTimeFormat("en-CA", { timeZone: row.timezone || "Asia/Kolkata" }).format(new Date(row.session_opened_at)) : null,
    cashManagementEnabled: row.cash_management_enabled, sellingLocationId: row.selling_location_id, sellingLocation: label(row.location_code, row.location_name),
    cashAccountId: finance ? row.cash_account_id : null, cashAccount: finance ? label(row.cash_account_code, row.cash_account_name) : null,
    paymentMethods: row.payment_methods ?? null, paymentDeviceRef: row.payment_device_ref, receiptPrefix: row.receipt_prefix,
    deviceLabel: row.device_label, receiptPrinter: row.receipt_printer, cashDrawer: row.cash_drawer, barcodeScanning: row.barcode_scanning, notes: row.notes,
    used: Boolean(row.first_used_at), firstUsedAt: row.first_used_at ?? null, lastActivity: lastActivity ? lastActivity.toISOString() : null, lastSaleAt: row.last_sale_at ?? null,
    version: n(row.version || 1), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// Terminals the person may see: terminal administrators see every terminal; anyone else with View Terminals sees those at the outlets
// they work at (all of them when they work everywhere).
async function visibleOutletIds(client, c) {
  if (c.roleSlugs?.some((slug) => BYPASS_ROLES.includes(slug))) return null;
  if (["pos.store.manage", "pos.settings.manage", "pos.terminal.manage", P.create, P.edit].some((permission) => c.permissions?.includes(permission))) return null;
  const { rows } = await client.query(`SELECT access.store_id FROM tenant.pos_cashier_outlets access JOIN tenant.pos_cashiers cashier ON cashier.organization_id = access.organization_id
    AND cashier.id = access.cashier_id WHERE access.organization_id = $1 AND cashier.user_id = $2`, [c.organizationId, c.userId ?? null]);
  return rows.map((row) => row.store_id);
}

// filters: view (all | active | inactive | session_open | available), search (code, name, outlet), outletId, status, state
// (available | session_open), cash ("yes" | "no").
export async function listTerminals(client, c, filters = {}) {
  require(c, P.view, "You do not have permission to view POS terminals.");
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["terminal.organization_id = $1"];
  const view = filters.view ?? "all";
  if (view === "active" || filters.status === "active") where.push("terminal.status = 'active'");
  if (view === "inactive" || filters.status === "inactive") where.push("terminal.status <> 'active'");
  if (view === "session_open" || filters.state === "session_open") where.push("session.id IS NOT NULL");
  if (view === "available" || filters.state === "available") where.push("session.id IS NULL AND terminal.status = 'active' AND outlet.active");
  if (filters.cash === "yes") where.push("terminal.cash_management_enabled");
  if (filters.cash === "no") where.push("NOT terminal.cash_management_enabled");
  if (filters.outletId && UUID.test(filters.outletId)) where.push(`terminal.store_id = ${bind(filters.outletId)}`);
  const term = text(filters.search);
  if (term) where.push(`lower(concat_ws(' ', terminal.code, terminal.name, outlet.code, outlet.name, terminal.device_label)) LIKE ${bind(`%${term.toLowerCase()}%`)}`);
  const visible = await visibleOutletIds(client, c);
  if (visible) where.push(`terminal.store_id = ANY(${bind(visible)}::uuid[])`);
  const { rows } = await client.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY lower(outlet.name), terminal.code`, values);
  return { terminals: rows.map((row) => toTerminal(row, c)), capabilities: terminalCapabilities(c) };
}

async function loadTerminal(client, c, terminalId, { lock = false } = {}) {
  const id = uuid(terminalId, "Terminal", "TERMINAL_NOT_FOUND");
  if (lock) await client.query(`SELECT id FROM tenant.pos_terminals WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, id]);
  const row = (await client.query(`${SELECT} WHERE terminal.organization_id = $1 AND terminal.id = $2`, [c.organizationId, id])).rows[0];
  if (!row) throw new PosTerminalError(404, "POS terminal not found.", "TERMINAL_NOT_FOUND");
  return row;
}

async function assertVisible(client, c, row) {
  const visible = await visibleOutletIds(client, c);
  if (visible && !visible.includes(row.store_id)) throw new PosTerminalError(404, "POS terminal not found.", "TERMINAL_NOT_FOUND");
}

// The terminal with its effective configuration and setup check.
export async function getTerminal(client, c, terminalId) {
  require(c, P.view, "You do not have permission to view POS terminals.");
  const row = await loadTerminal(client, c, terminalId);
  await assertVisible(client, c, row);
  return {
    ...toTerminal(row, c),
    effective: await effectiveOf(client, c.organizationId, row, { finance: can(c, "pos.outlets.view_finance") }),
    setup: await setupIssues(client, c, row),
    capabilities: terminalCapabilities(c),
  };
}

// ------------------------------------------------------------------ effective configuration

async function outletMethods(client, organizationId, outletId) {
  const { rows } = await client.query(
    `SELECT method.method, method.account_id, provider.provider_key FROM tenant.pos_store_payment_methods method
       LEFT JOIN tenant.pos_payment_provider_configs provider ON provider.organization_id = method.organization_id AND provider.store_id = method.store_id
             AND provider.payment_method = method.method AND provider.active
      WHERE method.organization_id = $1 AND method.store_id = $2 AND method.enabled`, [organizationId, outletId]);
  return new Map(rows.map((row) => [row.method, row]));
}

// The payment methods a terminal takes: the outlet's, narrowed by the terminal's own list, and cash only where it manages cash.
function effectiveMethods(row, outlet) {
  return METHOD_CODES.filter((method) => outlet.has(method) && (row.payment_methods === null || row.payment_methods === undefined || row.payment_methods.includes(method))
    && (method !== "cash" || row.cash_management_enabled));
}

async function effectiveOf(client, organizationId, row, { finance = true } = {}) {
  const outlet = (await client.query(
    `SELECT outlet.*, returns.code AS returns_code, returns.name AS returns_name, price_list.code AS price_list_code, price_list.name AS price_list_name,
            registration.code AS registration_code, registration.name AS registration_name, registration.registration_number,
            customer.display_name AS customer_name, cash_account.code AS cash_account_code, cash_account.name AS cash_account_name
       FROM tenant.pos_stores outlet
       LEFT JOIN tenant.warehouse_locations returns ON returns.organization_id = outlet.organization_id AND returns.id = outlet.returns_location_id
       LEFT JOIN tenant.price_lists price_list ON price_list.organization_id = outlet.organization_id AND price_list.id = outlet.price_list_id
       LEFT JOIN tenant.tax_registrations registration ON registration.organization_id = outlet.organization_id AND registration.id = outlet.tax_registration_id
       LEFT JOIN tenant.business_parties customer ON customer.organization_id = outlet.organization_id AND customer.id = outlet.default_customer_id
       LEFT JOIN tenant.accounting_accounts cash_account ON cash_account.organization_id = outlet.organization_id AND cash_account.id = outlet.cash_account_id
      WHERE outlet.organization_id = $1 AND outlet.id = $2`, [organizationId, row.store_id])).rows[0];
  const methods = await outletMethods(client, organizationId, row.store_id);
  const location = row.selling_location_id
    ? { id: row.selling_location_id, label: label(row.location_code, row.location_name), source: "terminal" }
    : row.outlet_location_id ? { id: row.outlet_location_id, label: label(row.outlet_location_code, row.outlet_location_name), source: "outlet" }
      : { id: null, label: null, source: "warehouse" };
  const cash = !row.cash_management_enabled ? { id: null, label: null, source: "none" }
    : row.cash_account_id ? { id: row.cash_account_id, label: label(row.cash_account_code, row.cash_account_name), source: "terminal" }
      : outlet.cash_account_id ? { id: outlet.cash_account_id, label: label(outlet.cash_account_code, outlet.cash_account_name), source: "outlet" }
        : { id: null, label: null, source: "company" };
  return {
    outletId: outlet.id, outlet: label(outlet.code, outlet.name), outletActive: outlet.active, terminalActive: row.status === "active",
    operable: row.status === "active" && outlet.active,
    warehouseId: outlet.warehouse_id, warehouse: label(row.warehouse_code, row.warehouse_name),
    sellingLocation: location, returnsLocation: { id: outlet.returns_location_id, label: label(outlet.returns_code, outlet.returns_name) },
    priceList: { id: outlet.price_list_id, label: label(outlet.price_list_code, outlet.price_list_name) },
    taxRegistration: { id: outlet.tax_registration_id, label: label(outlet.registration_code, outlet.registration_name), gstin: outlet.registration_number ?? null },
    walkInCustomer: { id: outlet.default_customer_id, label: outlet.customer_name ?? null },
    cashManagementEnabled: row.cash_management_enabled,
    cashAccount: finance ? cash : { id: null, label: null, source: cash.source },
    paymentMethods: effectiveMethods(row, methods).map((method) => ({ method, label: METHOD_LABEL[method], providerKey: method === "cash" ? null : methods.get(method)?.provider_key ?? null })),
    paymentDeviceRef: row.payment_device_ref, receiptPrefix: row.receipt_prefix, timezone: outlet.timezone, currencyCode: outlet.currency_code?.trim() ?? null,
  };
}

// Everything checkout needs, resolved once: terminal override, then outlet, then company default. Checkout never resolves precedence itself.
export async function getEffectiveTerminalConfiguration(client, c, terminalId) {
  const row = await loadTerminal(client, c, terminalId);
  return effectiveOf(client, c.organizationId, row, { finance: can(c, "pos.outlets.view_finance") || can(c, P.configureCash) });
}

// Does this terminal take this payment method now? (The outlet accepts it, the terminal does not exclude it, and cash only where cash is managed.)
export async function isTerminalPaymentMethodEnabled(client, organizationId, terminalId, method) {
  const row = (await client.query(`SELECT store_id, payment_methods, cash_management_enabled FROM tenant.pos_terminals WHERE organization_id = $1 AND id = $2`,
    [organizationId, terminalId])).rows[0];
  if (!row) return false;
  return effectiveMethods(row, await outletMethods(client, organizationId, row.store_id)).includes(method);
}

// The stock source of a sale at this terminal: always the outlet's warehouse; the terminal's selling location, else the outlet's, else none
// (the warehouse's own default). A location given by the caller is used only when it is a location of that same warehouse.
export async function resolveTerminalStockSource(client, organizationId, terminalId, requestedLocationId = null) {
  const row = (await client.query(
    `SELECT outlet.warehouse_id, COALESCE(terminal.selling_location_id, outlet.selling_location_id) AS location_id
       FROM tenant.pos_terminals terminal JOIN tenant.pos_stores outlet ON outlet.organization_id = terminal.organization_id AND outlet.id = terminal.store_id
      WHERE terminal.organization_id = $1 AND terminal.id = $2`, [organizationId, terminalId])).rows[0];
  if (!row) throw new PosTerminalError(404, "POS terminal not found.", "TERMINAL_NOT_FOUND");
  if (requestedLocationId) {
    const inside = (await client.query(`SELECT 1 FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = $2 AND warehouse_id = $3 AND status = 'active'`,
      [organizationId, requestedLocationId, row.warehouse_id])).rows[0];
    if (!inside) throw new PosTerminalError(409, "That location is not in this outlet's selling warehouse.", "INVALID_SELLING_LOCATION");
    return { warehouseId: row.warehouse_id, locationId: requestedLocationId };
  }
  return { warehouseId: row.warehouse_id, locationId: row.location_id ?? null };
}

// ------------------------------------------------------------------ operating

// May this person operate this terminal now? Active terminal, active outlet, a POS operating permission and access to the outlet (and,
// for terminal-limited access, to this terminal). Returns the terminal row.
export async function validateTerminalOperationAccess(client, c, terminalId) {
  if (!["pos.operate", "pos.shift.open", "pos.sale.create"].some((permission) => can(c, permission)))
    throw new PosTerminalError(403, "You do not have permission to operate POS terminals.", "TERMINAL_ACCESS_DENIED");
  const row = await loadTerminal(client, c, terminalId);
  if (row.status !== "active") throw new PosTerminalError(409, `Terminal ${row.code} is inactive.`, "TERMINAL_INACTIVE");
  if (!row.outlet_active) throw new PosTerminalError(409, `${row.outlet_name} is inactive, so its terminals cannot be used.`, "OUTLET_INACTIVE");
  await assertPosStoreAccess(client, c, row.store_id, row.id);
  return row;
}

// "Open POS" on a terminal: resume your own open session there, or go to opening one. Someone else's open session blocks it.
export async function openPosForTerminal(client, c, terminalId) {
  const row = await validateTerminalOperationAccess(client, c, terminalId);
  const terminal = toTerminal(row, c);
  if (row.session_id && row.session_cashier_id !== c.userId)
    throw new PosTerminalError(409, `Terminal ${row.code} already has an active POS session (${row.session_number}, ${row.session_cashier_name ?? "another cashier"}).`,
      "TERMINAL_SESSION_ALREADY_OPEN", { sessionId: row.session_id });
  return {
    action: row.session_id ? "resume" : "open_session", terminal, sessionId: row.session_id ?? null,
    configuration: await effectiveOf(client, c.organizationId, row, { finance: false }),
  };
}

// Before a session opens on this terminal (shift-operations.js): the terminal can be operated, no session is open on it, and a terminal
// that does not manage cash takes no opening float.
export async function assertTerminalCanOpenSession(client, c, terminalId, { openingCash = 0 } = {}) {
  const row = await validateTerminalOperationAccess(client, c, terminalId);
  if (row.session_id) throw new PosTerminalError(409, `Terminal ${row.code} already has an active POS session.`, "TERMINAL_SESSION_ALREADY_OPEN", { sessionId: row.session_id });
  if (!row.cash_management_enabled && n(openingCash) > 0)
    throw new PosTerminalError(409, `Terminal ${row.code} does not handle cash, so its session takes no opening cash.`, "TERMINAL_CASH_DISABLED");
  return row;
}

// ------------------------------------------------------------------ writing

async function checkOutlet(client, c, outletId) {
  const id = uuid(outletId, "Outlet");
  const outlet = (await client.query(`SELECT id, code, active FROM tenant.pos_stores WHERE organization_id = $1 AND id = $2`, [c.organizationId, id])).rows[0];
  if (!outlet) throw issue("outletId", "Choose an outlet of the company.", "TERMINAL_OUTLET_MISMATCH");
  return outlet;
}

async function checkCode(client, c, outletId, code, exceptId = null) {
  if (!CODE.test(code)) throw issue("code", "Use up to 30 letters, numbers, dots, dashes or slashes, such as T01.");
  const clash = (await client.query(`SELECT name FROM tenant.pos_terminals WHERE organization_id = $1 AND store_id = $2 AND upper(btrim(code)) = $3 AND ($4::uuid IS NULL OR id <> $4)`,
    [c.organizationId, outletId, code, exceptId])).rows[0];
  if (clash) throw issue("code", `${code} is already the code of ${clash.name} at this outlet.`, "TERMINAL_CODE_EXISTS", 409);
}

async function checkLocation(client, c, locationId, outletId) {
  const id = optionalId(locationId, "Selling location");
  if (!id) return null;
  const location = (await client.query(
    `SELECT location.code, location.status, location.allow_stock, location.warehouse_id = outlet.warehouse_id AS inside
       FROM tenant.warehouse_locations location JOIN tenant.pos_stores outlet ON outlet.organization_id = location.organization_id AND outlet.id = $3
      WHERE location.organization_id = $1 AND location.id = $2`, [c.organizationId, id, outletId])).rows[0];
  if (!location || !location.inside) throw issue("sellingLocationId", "Choose a location of the outlet's selling warehouse.", "INVALID_SELLING_LOCATION");
  if (location.status !== "active" || !location.allow_stock) throw issue("sellingLocationId", `${location.code} is inactive or does not hold stock.`, "INVALID_SELLING_LOCATION");
  return id;
}

async function checkCashAccount(client, c, accountId) {
  const id = optionalId(accountId, "Cash account");
  if (!id) return null;
  const account = (await client.query(`SELECT account_type, is_group, status, code FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = $2`, [c.organizationId, id])).rows[0];
  if (!account || account.is_group || account.status !== "active" || account.account_type !== "cash")
    throw issue("cashAccountId", "Choose an active cash account of the company's chart.", "POS_TERMINAL_ACCOUNT_INVALID");
  return id;
}

// null keeps every method the outlet accepts; a list must be within the outlet's.
async function checkMethods(client, c, value, outletId) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw issue("paymentMethods", "Choose the payment methods this terminal takes.");
  const list = [...new Set(value.map((method) => String(method).trim().toLowerCase()))];
  if (list.some((method) => !METHOD_CODES.includes(method))) throw issue("paymentMethods", "Choose from cash, card, UPI, wallet and bank transfer.", "PAYMENT_METHOD_NOT_AVAILABLE");
  const outlet = await outletMethods(client, c.organizationId, outletId);
  const missing = list.filter((method) => !outlet.has(method));
  if (missing.length) throw issue("paymentMethods", `The outlet does not accept ${missing.map((method) => METHOD_LABEL[method]).join(", ")}. Enable it on the outlet first.`, "PAYMENT_METHOD_NOT_AVAILABLE");
  return METHOD_CODES.filter((method) => list.includes(method));
}

function checkPrefix(value) {
  const prefix = String(value ?? "").trim().toUpperCase();
  if (!PREFIX.test(prefix)) throw issue("receiptPrefix", "Use up to 24 letters, numbers, dashes, slashes or underscores, such as PUN-T01.");
  return prefix;
}

async function guarded(client, run) {
  await client.query("SAVEPOINT terminal_write");
  try { const result = await run(); await client.query("RELEASE SAVEPOINT terminal_write"); return result; } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT terminal_write");
    if (error?.code === "23505" && /code/.test(error.constraint ?? "")) throw issue("code", "Another terminal with this code was just saved at this outlet. Reload and try again.", "TERMINAL_CODE_EXISTS", 409);
    if (error?.code === "23514" && error.constraint === "pos_terminals_location_in_warehouse") throw issue("sellingLocationId", error.message, "INVALID_SELLING_LOCATION", 409);
    if (error?.code === "23514" && error.constraint === "pos_terminals_outlet_fixed") throw issue("outletId", error.message, "TERMINAL_OUTLET_FIXED", 409);
    throw error;
  }
}

async function usedBy(client, c, terminalId) {
  const used = [];
  for (const [what, table] of [["sessions", "pos_shifts"], ["carts", "pos_carts"], ["sales", "pos_sales"], ["returns", "pos_returns"], ["day-end reports", "pos_day_end_reports"]])
    if ((await client.query(`SELECT 1 FROM tenant.${table} WHERE organization_id = $1 AND terminal_id = $2 LIMIT 1`, [c.organizationId, terminalId])).rows[0]) used.push(what);
  return used;
}

// input: { outletId, code, name, cashManagementEnabled, sellingLocationId, cashAccountId, paymentMethods (null: the outlet's), paymentDeviceRef,
// receiptPrefix (default OUTLET-CODE), deviceLabel, receiptPrinter, cashDrawer, barcodeScanning, notes }. Active when its outlet is.
export async function createTerminal(client, c, input = {}) {
  require(c, P.create, "You do not have permission to create POS terminals.");
  if (!input.outletId && !input.storeId) throw issue("outletId", "Choose the outlet this terminal belongs to.", "TERMINAL_OUTLET_MISMATCH");
  const outlet = await checkOutlet(client, c, input.outletId ?? input.storeId);
  const code = normalizeTerminalCode(input.code);
  await checkCode(client, c, outlet.id, code);
  const name = text(input.name, 160);
  if (!name) throw issue("name", "Enter the terminal name, such as Counter 1.");
  const configure = (key, permission, message) => { if (has(input, key) && input[key] !== null && input[key] !== undefined && input[key] !== "") require(c, permission, message); };
  configure("sellingLocationId", P.configureInventory, "You do not have permission to choose a terminal's selling location.");
  configure("cashAccountId", P.configureCash, "You do not have permission to choose a terminal's cash account.");
  configure("paymentMethods", P.configurePayments, "You do not have permission to restrict a terminal's payment methods.");
  const sellingLocationId = await checkLocation(client, c, input.sellingLocationId, outlet.id);
  const cashAccountId = await checkCashAccount(client, c, input.cashAccountId);
  const paymentMethods = await checkMethods(client, c, input.paymentMethods, outlet.id);
  const receiptPrefix = text(input.receiptPrefix) ? checkPrefix(input.receiptPrefix) : sanitizePrefix(`${outlet.code}-${code}`) || "POS";
  const id = await guarded(client, async () => (await client.query(
    `INSERT INTO tenant.pos_terminals (organization_id, store_id, code, name, status, receipt_prefix, cash_management_enabled, selling_location_id, cash_account_id,
       payment_methods, payment_device_ref, device_label, receipt_printer, cash_drawer, barcode_scanning, notes, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17) RETURNING id`,
    [c.organizationId, outlet.id, code, name, outlet.active ? "active" : "inactive", receiptPrefix, input.cashManagementEnabled !== false, sellingLocationId, cashAccountId,
      paymentMethods, text(input.paymentDeviceRef, 120), text(input.deviceLabel, 120), text(input.receiptPrinter, 120), input.cashDrawer === true,
      input.barcodeScanning !== false, text(input.notes, 2000), c.userId ?? null])).rows[0].id);
  await history(client, c, id, "created", `Terminal ${code} created at ${outlet.code}${outlet.active ? "" : " (inactive until the outlet is active)"}`, { code, name, outlet: outlet.code });
  return getTerminal(client, c, id);
}

// Field groups, who may change them, and which are locked while a session is open.
const GROUPS = {
  general: { columns: ["code", "name", "notes", "store_id"], permission: P.edit, message: "You do not have permission to edit POS terminals." },
  inventory: { columns: ["selling_location_id"], permission: P.configureInventory, message: "You do not have permission to change a terminal's selling location." },
  cash: { columns: ["cash_management_enabled", "cash_account_id"], permission: P.configureCash, message: "You do not have permission to change a terminal's cash setup." },
  payments: { columns: ["payment_methods", "payment_device_ref"], permission: P.configurePayments, message: "You do not have permission to change a terminal's payment setup." },
  numbering: { columns: ["receipt_prefix"], permission: P.configureNumbering, message: "You do not have permission to change a terminal's receipt numbering." },
  hardware: { columns: ["device_label", "receipt_printer", "cash_drawer", "barcode_scanning"], permission: P.configureHardware, message: "You do not have permission to change a terminal's hardware." },
};
const POSTING_CRITICAL = ["store_id", "selling_location_id", "cash_management_enabled", "cash_account_id", "payment_methods", "payment_device_ref", "receipt_prefix"];

// input: any field of createTerminal, expectedVersion, reason. A used terminal keeps its outlet and code; posting-critical settings wait for
// its open session to close. New sessions and sales use the new values; recorded ones keep theirs.
export async function updateTerminal(client, c, terminalId, input = {}) {
  require(c, P.view, "You do not have permission to view POS terminals.");
  const row = await loadTerminal(client, c, terminalId, { lock: true });
  if (has(input, "expectedVersion") && input.expectedVersion !== null && input.expectedVersion !== undefined && Number(input.expectedVersion) !== Number(row.version))
    throw new PosTerminalError(409, "Someone else changed this terminal after you opened it. Reload it.", "POS_TERMINAL_VERSION_CONFLICT");
  const outletId = has(input, "outletId") && input.outletId ? (await checkOutlet(client, c, input.outletId)).id : row.store_id;
  const code = has(input, "code") ? normalizeTerminalCode(input.code) : row.code;
  // A used terminal keeps its outlet and its code: reports and receipts identify the register by them.
  if (outletId !== row.store_id || code !== row.code) {
    const used = await usedBy(client, c, row.id);
    if (used.length && outletId !== row.store_id)
      throw issue("outletId", `Terminal ${row.code} has ${used.join(", ")}, so it stays at ${row.outlet_code}. Deactivate it and add a terminal at the other outlet.`, "TERMINAL_OUTLET_FIXED", 409);
    if (used.length) throw issue("code", `Terminal ${row.code} has ${used.join(", ")}, so its code stays. You can still rename it.`, "TERMINAL_CODE_FIXED", 409);
    await checkCode(client, c, outletId, code, row.id);
  }
  const name = has(input, "name") ? text(input.name, 160) : row.name;
  if (!name) throw issue("name", "Enter the terminal name, such as Counter 1.");
  // A new outlet means its warehouse: a selling location of the old one is cleared unless a new one is given.
  const sellingLocationId = has(input, "sellingLocationId") ? await checkLocation(client, c, input.sellingLocationId, outletId)
    : outletId !== row.store_id ? null : row.selling_location_id;
  const next = {
    code, name, notes: has(input, "notes") ? text(input.notes, 2000) : row.notes, store_id: outletId, selling_location_id: sellingLocationId,
    cash_management_enabled: has(input, "cashManagementEnabled") ? input.cashManagementEnabled !== false : row.cash_management_enabled,
    cash_account_id: has(input, "cashAccountId") ? await checkCashAccount(client, c, input.cashAccountId) : row.cash_account_id,
    payment_methods: has(input, "paymentMethods") ? await checkMethods(client, c, input.paymentMethods, outletId) : row.payment_methods,
    payment_device_ref: has(input, "paymentDeviceRef") ? text(input.paymentDeviceRef, 120) : row.payment_device_ref,
    receipt_prefix: has(input, "receiptPrefix") ? checkPrefix(input.receiptPrefix) : row.receipt_prefix,
    device_label: has(input, "deviceLabel") ? text(input.deviceLabel, 120) : row.device_label,
    receipt_printer: has(input, "receiptPrinter") ? text(input.receiptPrinter, 120) : row.receipt_printer,
    cash_drawer: has(input, "cashDrawer") ? input.cashDrawer === true : row.cash_drawer,
    barcode_scanning: has(input, "barcodeScanning") ? input.barcodeScanning !== false : row.barcode_scanning,
  };
  const same = (a, b) => (Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a ?? null) === JSON.stringify(b ?? null) : String(a ?? "") === String(b ?? ""));
  const changed = Object.keys(next).filter((column) => !same(next[column], row[column]));
  if (!changed.length) return getTerminal(client, c, row.id);
  for (const group of Object.values(GROUPS)) if (changed.some((column) => group.columns.includes(column))) require(c, group.permission, group.message);
  const critical = changed.filter((column) => POSTING_CRITICAL.includes(column));
  if (critical.length && row.session_id)
    throw new PosTerminalError(409, `Terminal ${row.code} has an open session (${row.session_number}). Close it before changing ${critical.map((column) => column.replace(/_id$/, "").replace(/_/g, " ")).join(", ")}; the name, notes and hardware can change now.`,
      "TERMINAL_CONFIGURATION_LOCKED", { fields: critical });
  await guarded(client, () => client.query(
    `UPDATE tenant.pos_terminals SET ${changed.map((column, index) => `${column} = $${index + 3}`).join(", ")}, version = version + 1, updated_by = $${changed.length + 3}, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, ...changed.map((column) => next[column]), c.userId ?? null]));
  const diff = (columns) => Object.fromEntries(columns.filter((column) => changed.includes(column)).map((column) => [column, { from: row[column] ?? null, to: next[column] ?? null }]));
  const reason = text(input.reason, 300);
  const events = [
    ["code_changed", ["code"], `Code changed from ${row.code} to ${code}`],
    ["outlet_changed", ["store_id"], "Moved to another outlet (unused terminal)"],
    ["updated", ["name", "notes"], changed.includes("name") ? `Name changed from ${row.name} to ${name}` : "Notes changed"],
    ["location_changed", ["selling_location_id"], "Selling location changed (new sales take stock from it)"],
    ["cash_changed", ["cash_management_enabled", "cash_account_id"], next.cash_management_enabled ? "Cash setup changed" : "Cash management turned off"],
    ["payment_methods_changed", ["payment_methods"], next.payment_methods ? `Payment methods: ${next.payment_methods.map((method) => METHOD_LABEL[method]).join(", ") || "none"}` : "Payment methods: all the outlet accepts"],
    ["payment_device_changed", ["payment_device_ref"], "Payment device changed"],
    ["numbering_changed", ["receipt_prefix"], `Receipt series changed from ${row.receipt_prefix} to ${next.receipt_prefix}`],
    ["hardware_changed", ["device_label", "receipt_printer", "cash_drawer", "barcode_scanning"], "Hardware details changed"],
  ];
  for (const [type, columns, summary] of events) if (columns.some((column) => changed.includes(column))) await history(client, c, row.id, type, summary, diff(columns), reason);
  return getTerminal(client, c, row.id);
}

// ------------------------------------------------------------------ activation, deactivation, deletion

async function setupIssues(client, c, row) {
  const issues = [];
  if (!row.outlet_active) issues.push({ code: "OUTLET_INACTIVE", field: "outletId", message: `The outlet ${row.outlet_code} is inactive. Activate the outlet first.` });
  if (row.selling_location_id) {
    const inside = (await client.query(`SELECT 1 FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = $2 AND warehouse_id = $3 AND status = 'active'`,
      [c.organizationId, row.selling_location_id, row.warehouse_id])).rows[0];
    if (!inside) issues.push({ code: "INVALID_SELLING_LOCATION", field: "sellingLocationId", message: "The selling location is no longer an active location of the outlet's warehouse." });
  }
  if (row.cash_management_enabled && row.cash_account_id) {
    const account = (await client.query(`SELECT 1 FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = $2 AND status = 'active' AND NOT is_group`, [c.organizationId, row.cash_account_id])).rows[0];
    if (!account) issues.push({ code: "CASH_ACCOUNT", field: "cashAccountId", message: "The cash account is inactive. Choose another." });
  }
  if (!PREFIX.test(row.receipt_prefix ?? "")) issues.push({ code: "NUMBERING", field: "receiptPrefix", message: "Set a valid receipt series." });
  if (!effectiveMethods(row, await outletMethods(client, c.organizationId, row.store_id)).length)
    issues.push({ code: "PAYMENTS", field: "paymentMethods", message: "The terminal takes no payment method. Enable one on the outlet, widen the terminal's list, or turn cash management on." });
  return issues;
}

export async function validateTerminalSetup(client, c, terminalId) {
  require(c, P.view, "You do not have permission to view POS terminals.");
  const row = await loadTerminal(client, c, terminalId);
  await assertVisible(client, c, row);
  return setupIssues(client, c, row);
}

// What stands between an active terminal and Inactive ([] when it can be deactivated).
export async function validateTerminalForDeactivation(client, c, terminalId) {
  require(c, P.view, "You do not have permission to view POS terminals.");
  const row = await loadTerminal(client, c, terminalId);
  const count = async (sql) => n((await client.query(sql, [c.organizationId, row.id])).rows[0].count);
  const blockers = [];
  for (const [code, word, message, sql] of [
    ["OPEN_SESSION", "open POS session", "Close the active POS session before deactivating this terminal.", `SELECT count(*)::int AS count FROM tenant.pos_shifts WHERE organization_id = $1 AND terminal_id = $2 AND status IN ${OPEN_SESSION}`],
    ["ACTIVE_CARTS", "open or held cart", "Complete or cancel them first.", `SELECT count(*)::int AS count FROM tenant.pos_carts WHERE organization_id = $1 AND terminal_id = $2 AND status IN ('draft', 'priced', 'held')`],
    ["POSTING_FAILURES", "sale or return that failed to post to accounting", "Retry the posting first.", `SELECT (SELECT count(*) FROM tenant.pos_sales WHERE organization_id = $1 AND terminal_id = $2 AND accounting_posting_status = 'failed')
       + (SELECT count(*) FROM tenant.pos_returns WHERE organization_id = $1 AND terminal_id = $2 AND accounting_posting_status = 'failed') AS count`],
  ]) {
    const found = await count(sql);
    if (found > 0) blockers.push({ code, count: found, message: `${plural(found, word)}. ${message}` });
  }
  return blockers;
}

export async function setTerminalStatus(client, c, terminalId, status, input = {}) {
  require(c, P.status, "You do not have permission to activate or deactivate POS terminals.");
  if (!["active", "inactive"].includes(status)) throw issue("status", "Choose Active or Inactive.");
  const row = await loadTerminal(client, c, terminalId, { lock: true });
  if (row.status === status) throw new PosTerminalError(409, `This terminal is already ${status}.`, "POS_TERMINAL_STATUS_UNCHANGED");
  if (status === "active") {
    const missing = await setupIssues(client, c, row);
    if (missing.length) throw new PosTerminalError(409, `This terminal cannot be activated yet. ${missing.map((entry) => entry.message).join(" ")}`, "TERMINAL_SETUP_INCOMPLETE", { issues: missing });
  } else {
    const blockers = await validateTerminalForDeactivation(client, c, row.id);
    if (blockers.length) throw new PosTerminalError(409, `This terminal cannot be deactivated. ${blockers.map((entry) => entry.message).join(" ")}`, "TERMINAL_DEACTIVATION_BLOCKED", { blockers });
  }
  await client.query(`UPDATE tenant.pos_terminals SET status = $3, version = version + 1, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, status, c.userId ?? null]);
  await history(client, c, row.id, status === "active" ? "activated" : "deactivated", status === "active" ? "Activated" : "Deactivated", { from: row.status, to: status }, text(input.reason, 300));
  return getTerminal(client, c, row.id);
}

// Only a terminal nothing has ever used can be deleted; anything else is deactivated.
export async function deleteTerminal(client, c, terminalId) {
  require(c, P.status, "You do not have permission to delete POS terminals.");
  const row = await loadTerminal(client, c, terminalId, { lock: true });
  const used = await usedBy(client, c, row.id);
  if (used.length) throw new PosTerminalError(409, `This terminal has ${used.join(", ")}. Deactivate it instead.`, "POS_TERMINAL_IN_USE", { references: used });
  await client.query(`DELETE FROM tenant.pos_terminals WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id]);
  return { deleted: true };
}

// ------------------------------------------------------------------ inquiries

// Sessions on the terminal, the open one first; the business date is the opening day in the outlet's time zone.
export async function getTerminalSessions(client, c, terminalId) {
  require(c, P.viewSessions, "You do not have permission to view the sessions of a terminal.");
  const row = await loadTerminal(client, c, terminalId);
  await assertVisible(client, c, row);
  const finance = can(c, "pos.outlets.view_finance");
  const { rows } = await client.query(
    `SELECT shift.id, shift.shift_number, shift.status, shift.opened_at, shift.closed_at, shift.opening_cash, shift.cash_variance, cashier.full_name AS cashier_name,
            (shift.opened_at AT TIME ZONE $3)::date::text AS business_date
       FROM tenant.pos_shifts shift LEFT JOIN public.users cashier ON cashier.id = shift.cashier_user_id
      WHERE shift.organization_id = $1 AND shift.terminal_id = $2
      ORDER BY (shift.status IN ${OPEN_SESSION}) DESC, shift.opened_at DESC NULLS FIRST LIMIT 500`, [c.organizationId, row.id, row.timezone || "Asia/Kolkata"]);
  return rows.map((session) => ({
    id: session.id, number: session.shift_number, status: session.status, cashier: session.cashier_name, businessDate: session.business_date, openedAt: session.opened_at,
    closedAt: session.closed_at, ...(finance ? { openingCash: round(session.opening_cash), difference: session.cash_variance === null ? null : round(session.cash_variance) } : {}),
  }));
}

export async function getCurrentTerminalSession(client, c, terminalId) {
  require(c, P.view, "You do not have permission to view POS terminals.");
  const row = await loadTerminal(client, c, terminalId);
  await assertVisible(client, c, row);
  return row.session_id ? { id: row.session_id, number: row.session_number, status: row.session_status, cashierId: row.session_cashier_id, cashier: row.session_cashier_name,
    openedAt: row.session_opened_at } : null;
}

// Sales and returns on the terminal, newest first. kind: sales | returns (both when omitted).
export async function getTerminalTransactions(client, c, terminalId, filters = {}) {
  require(c, P.viewTransactions, "You do not have permission to view the transactions of a terminal.");
  const row = await loadTerminal(client, c, terminalId);
  await assertVisible(client, c, row);
  const kind = ["sales", "returns", "voided"].includes(filters.kind) ? filters.kind : null;
  const { rows } = await client.query(
    `SELECT * FROM (
       SELECT sale.id, 'sale' AS kind, sale.receipt_number AS number, sale.completed_at AS at, cashier.full_name AS cashier_name,
              COALESCE(sale.customer_name, customer.display_name) AS customer_name, sale.grand_total AS amount, sale.status,
              (SELECT count(*)::int FROM tenant.pos_sale_lines line WHERE line.organization_id = sale.organization_id AND line.sale_id = sale.id) AS items,
              (SELECT string_agg(DISTINCT payment.payment_method, ', ') FROM tenant.pos_payments payment WHERE payment.organization_id = sale.organization_id AND payment.cart_id = sale.cart_id) AS payment
         FROM tenant.pos_sales sale
         LEFT JOIN tenant.pos_shifts shift ON shift.organization_id = sale.organization_id AND shift.id = sale.shift_id
         LEFT JOIN public.users cashier ON cashier.id = shift.cashier_user_id
         LEFT JOIN tenant.business_parties customer ON customer.organization_id = sale.organization_id AND customer.id = sale.customer_id
        WHERE sale.organization_id = $1 AND sale.terminal_id = $2 AND sale.status <> 'draft'
       UNION ALL
       SELECT ret.id, 'return', ret.return_number, COALESCE(ret.completed_at, ret.created_at), cashier.full_name, NULL, -ret.refund_total, ret.status, NULL, NULL
         FROM tenant.pos_returns ret
         LEFT JOIN tenant.pos_shifts shift ON shift.organization_id = ret.organization_id AND shift.id = ret.shift_id
         LEFT JOIN public.users cashier ON cashier.id = shift.cashier_user_id
        WHERE ret.organization_id = $1 AND ret.terminal_id = $2
     ) entry
     WHERE ($3::text IS NULL OR ($3 = 'sales' AND entry.kind = 'sale' AND entry.status <> 'voided') OR ($3 = 'returns' AND entry.kind = 'return') OR ($3 = 'voided' AND entry.status = 'voided'))
     ORDER BY entry.at DESC NULLS LAST LIMIT 500`, [c.organizationId, row.id, kind]);
  return rows.map((entry) => ({
    id: entry.id, kind: entry.kind, number: entry.number, at: entry.at, cashier: entry.cashier_name, customer: entry.customer_name, items: entry.items,
    amount: round(entry.amount), payment: entry.payment, status: entry.status,
  }));
}

export async function getTerminalHistory(client, c, terminalId) {
  require(c, P.view, "You do not have permission to view POS terminals.");
  const { rows } = await client.query(
    `SELECT history.*, actor.full_name AS actor_name FROM tenant.pos_terminal_history history LEFT JOIN public.users actor ON actor.id = history.actor_user_id
      WHERE history.organization_id = $1 AND history.terminal_id = $2 ORDER BY history.created_at DESC, history.id DESC LIMIT 300`, [c.organizationId, uuid(terminalId, "Terminal")]);
  return rows.map((row) => ({ id: row.id, eventType: row.event_type, summary: row.summary, changes: row.changes, reason: row.reason, actorName: row.actor_name, createdAt: row.created_at }));
}

// What the terminal screens need: outlets (with their warehouse, accepted payment methods and locations), cash accounts, methods.
export async function getTerminalOptions(client, c) {
  require(c, P.view, "You do not have permission to view POS terminals.");
  const outlets = (await client.query(
    `SELECT outlet.id, outlet.code, outlet.name, outlet.active, outlet.warehouse_id,
            COALESCE((SELECT array_agg(method.method) FROM tenant.pos_store_payment_methods method WHERE method.organization_id = outlet.organization_id AND method.store_id = outlet.id AND method.enabled), ARRAY[]::text[]) AS methods
       FROM tenant.pos_stores outlet WHERE outlet.organization_id = $1 ORDER BY outlet.active DESC, lower(outlet.name)`, [c.organizationId])).rows;
  const visible = await visibleOutletIds(client, c);
  const locations = (await client.query(`SELECT id, warehouse_id, code, name FROM tenant.warehouse_locations WHERE organization_id = $1 AND status = 'active' AND allow_stock ORDER BY code`,
    [c.organizationId])).rows;
  const accounts = can(c, P.configureCash) || can(c, "pos.outlets.view_finance")
    ? (await client.query(`SELECT id, code, name FROM tenant.accounting_accounts WHERE organization_id = $1 AND status = 'active' AND NOT is_group AND account_type = 'cash' ORDER BY code`,
      [c.organizationId])).rows : [];
  return {
    outlets: outlets.filter((outlet) => !visible || visible.includes(outlet.id)).map((outlet) => ({
      id: outlet.id, label: label(outlet.code, outlet.name), code: outlet.code, active: outlet.active, warehouseId: outlet.warehouse_id,
      methods: METHOD_CODES.filter((method) => outlet.methods.includes(method)),
    })),
    locations: locations.map((row) => ({ id: row.id, warehouseId: row.warehouse_id, label: label(row.code, row.name) })),
    cashAccounts: accounts.map((row) => ({ id: row.id, label: label(row.code, row.name) })),
    paymentMethods: OUTLET_PAYMENT_METHODS, capabilities: terminalCapabilities(c),
  };
}
