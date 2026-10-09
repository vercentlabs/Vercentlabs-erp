// Warehouses: the master of where stock is held — a facility of the organization (the owning company) with its address, capabilities
// (receiving, shipping, transfers, returns), manager, internal locations and who may work in it. A warehouse never holds an editable
// quantity: on hand, reserved, available, incoming, outgoing and value are read from Inventory's balances, ledger and open documents.
//
// Locations: every warehouse has MAIN, its default storage location. In the ledger, stock with no location is stock in MAIN, so a
// warehouse can be used without ever choosing a location; ledgerLocation() turns a MAIN chosen on a form into that same "no location".
//
// Access: validateWarehouseOperation() is the one check every stock operation goes through — the warehouse exists in this organization,
// is active, allows the operation (receive, ship, transfer, returns) and the user may work in it. A user listed on some warehouses may work
// only in those; a warehouse with people listed only accepts them; with nobody listed on either side, permissions alone decide.
import { WAREHOUSE_PERMISSIONS as W } from "@vercentlabs/permissions";

import { restrictedStockSql } from "./rules.js";

export class WarehouseError extends Error {
  constructor(status, message, code = "WAREHOUSE_ERROR", details = undefined) {
    super(message);
    this.name = "WarehouseError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const WAREHOUSE_OPERATIONS = Object.freeze(["receive", "ship", "transfer", "adjust", "opening", "purchase_return", "sales_return"]);
export const WAREHOUSE_OPERATION_LABELS = Object.freeze({
  receive: "Receive", ship: "Ship", transfer: "Transfer", adjust: "Adjust", opening: "Opening stock", purchase_return: "Purchase returns", sales_return: "Sales returns",
});
export const WAREHOUSE_TYPES = Object.freeze([{ code: "stores", label: "Standard" }, { code: "transit", label: "Transit" }]);
export const LOCATION_PURPOSES = Object.freeze([
  { code: "storage", label: "Storage" }, { code: "receiving", label: "Receiving" }, { code: "quality_hold", label: "Quality hold" }, { code: "returns", label: "Returns" },
  { code: "shipping", label: "Shipping" }, { code: "transit", label: "Transit" },
]);
export const LOCATION_STRUCTURES = Object.freeze(["zone", "aisle", "rack", "bin", "staging", "other"]);
// What a location's stock is: available stock counts toward Available; held stock (quality hold, quarantined, damaged) is on hand but never
// allocated. A location may also hold available-disposition stock that is not to be allocated (allowAllocation false).
export const LOCATION_DISPOSITIONS = Object.freeze([
  { code: "available", label: "Available" }, { code: "quality_hold", label: "Quality hold" }, { code: "quarantined", label: "Quarantined" }, { code: "damaged", label: "Damaged" },
]);
// The capability each operation needs (adjustments and opening stock need none).
const CAPABILITY = Object.freeze({ receive: "receiving_enabled", ship: "shipping_enabled", transfer: "transfer_enabled", purchase_return: "returns_enabled", sales_return: "returns_enabled" });
const CAPABILITY_LABEL = Object.freeze({ receiving_enabled: "receiving", shipping_enabled: "shipping", transfer_enabled: "transfers", returns_enabled: "returns" });
const CODE = /^[A-Z0-9][A-Z0-9._/-]{0,29}$/;
const LOCATION_CODE = /^[A-Z0-9][A-Z0-9._/-]{0,29}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const can = (c, permission) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)) || c.permissions?.includes(permission));
const require = (c, permission, message) => { if (!can(c, permission)) throw new WarehouseError(403, message, "PERMISSION_DENIED"); };
const text = (value, max = 500) => { const out = String(value ?? "").trim().replace(/\s+/g, " "); return out ? out.slice(0, max) : null; };
const has = (input, key) => Object.prototype.hasOwnProperty.call(input ?? {}, key);
const issue = (field, message, code = "WAREHOUSE_VALIDATION", status = 400) => new WarehouseError(status, message, code, { issues: [{ field, message }] });
const uuid = (value, label) => { const id = String(value ?? "").trim(); if (!UUID.test(id)) throw new WarehouseError(400, `${label} is not valid.`, "WAREHOUSE_VALIDATION"); return id; };
const flag = (value, fallback) => (value === undefined || value === null ? fallback : value === true || value === "true" || value === "yes");
const n = (value) => Number(value ?? 0);
const round = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
export const normalizeWarehouseCode = (value) => String(value ?? "").normalize("NFKC").trim().toUpperCase();

async function history(client, c, warehouseId, eventType, summary, changes = {}, reason = null) {
  await client.query(
    `INSERT INTO tenant.warehouse_history (organization_id, warehouse_id, event_type, summary, changes, reason, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [c.organizationId, warehouseId, eventType, String(summary).slice(0, 500), JSON.stringify(changes), reason, c.userId ?? null]);
}

// ------------------------------------------------------------------ reading

const SELECT = `
  SELECT warehouse.*, manager.full_name AS manager_name, registration.code AS registration_code, registration.name AS registration_name,
         main.id AS main_location_id
    FROM tenant.warehouses warehouse
    LEFT JOIN public.users manager ON manager.id = warehouse.manager_user_id
    LEFT JOIN tenant.tax_registrations registration ON registration.organization_id = warehouse.organization_id AND registration.id = warehouse.tax_registration_id
    LEFT JOIN tenant.warehouse_locations main ON main.organization_id = warehouse.organization_id AND main.warehouse_id = warehouse.id AND main.is_default_storage`;

// Quantities of a warehouse (or of every warehouse) from Inventory's balances: on hand, reserved, available, held in quality locations,
// the items it holds and — for those who may see it — the value.
const STOCK_FIGURES = `
  SELECT balance.warehouse_id, sum(balance.quantity) AS on_hand, sum(balance.reserved_quantity) AS reserved,
         sum(CASE WHEN ${restrictedStockSql("location", "batch")} THEN balance.quantity ELSE 0 END) AS restricted,
         sum(balance.quantity * balance.average_cost) AS value, count(DISTINCT balance.item_id) FILTER (WHERE balance.quantity <> 0) AS items
    FROM tenant.stock_balances balance
    LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
    LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
   WHERE balance.organization_id = $1`;

function toWarehouse(row, { figures = null, value = false } = {}) {
  const address = [row.address_line1, row.address_line2, row.city, row.state, row.postal_code, row.country_code].filter(Boolean);
  const stock = figures ? {
    onHand: round(figures.on_hand), reserved: round(figures.reserved), restricted: round(figures.restricted),
    available: round(n(figures.on_hand) - n(figures.reserved) - n(figures.restricted)), items: n(figures.items), ...(value ? { value: round(figures.value) } : {}),
  } : { onHand: 0, reserved: 0, restricted: 0, available: 0, items: 0, ...(value ? { value: 0 } : {}) };
  return {
    id: row.id, code: row.code, name: row.name, description: row.description, type: row.warehouse_type === "transit" ? "transit" : "stores",
    typeLabel: row.warehouse_type === "transit" ? "Transit" : "Standard",
    address: { line1: row.address_line1, line2: row.address_line2, city: row.city, state: row.state, stateCode: row.state_code, postalCode: row.postal_code, countryCode: row.country_code },
    addressText: address.join(", "), timezone: row.timezone, managerUserId: row.manager_user_id, managerName: row.manager_name, contactName: row.contact_name, phone: row.phone, email: row.email,
    taxRegistrationId: row.tax_registration_id, taxRegistration: row.registration_code ? `${row.registration_code} · ${row.registration_name}` : null,
    receivingEnabled: row.receiving_enabled, shippingEnabled: row.shipping_enabled, transferEnabled: row.transfer_enabled, returnsEnabled: row.returns_enabled,
    isDefault: row.is_default, system: Boolean(row.system_role), status: row.status, isActive: row.status === "active", mainLocationId: row.main_location_id,
    version: Number(row.version ?? 1), createdAt: row.created_at, updatedAt: row.updated_at, stock,
  };
}

// filters: view (all | active | inactive | mine), search (code, name, city, address, manager), status, state, city, managerUserId,
// receiving / shipping ("yes" | "no").
export async function listWarehouses(client, c, filters = {}) {
  require(c, W.view, "You do not have permission to view warehouses.");
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["warehouse.organization_id = $1"];
  const view = filters.view ?? "all";
  if (view === "active" || filters.status === "active") where.push("warehouse.status = 'active'");
  if (view === "inactive" || filters.status === "inactive") where.push("warehouse.status = 'inactive'");
  if (view === "mine") where.push(`(warehouse.manager_user_id = ${bind(c.userId ?? null)} OR EXISTS (SELECT 1 FROM tenant.warehouse_user_access access
    WHERE access.organization_id = warehouse.organization_id AND access.warehouse_id = warehouse.id AND access.user_id = ${bind(c.userId ?? null)}))`);
  const term = text(filters.search);
  if (term) where.push(`lower(concat_ws(' ', warehouse.code, warehouse.name, warehouse.city, warehouse.state, warehouse.address_line1, manager.full_name)) LIKE ${bind(`%${term.toLowerCase()}%`)}`);
  if (text(filters.state)) where.push(`lower(warehouse.state) = lower(${bind(text(filters.state))})`);
  if (text(filters.city)) where.push(`lower(warehouse.city) = lower(${bind(text(filters.city))})`);
  if (filters.managerUserId && UUID.test(filters.managerUserId)) where.push(`warehouse.manager_user_id = ${bind(filters.managerUserId)}`);
  for (const [key, column] of [["receiving", "receiving_enabled"], ["shipping", "shipping_enabled"]]) {
    if (filters[key] === "yes") where.push(`warehouse.${column}`);
    if (filters[key] === "no") where.push(`NOT warehouse.${column}`);
  }
  const { rows } = await client.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY warehouse.is_default DESC, warehouse.status, lower(warehouse.name)`, values);
  const showStock = can(c, W.viewStock);
  const showValue = can(c, W.viewValue);
  const figures = showStock ? new Map((await client.query(`${STOCK_FIGURES} GROUP BY balance.warehouse_id`, [c.organizationId])).rows.map((row) => [row.warehouse_id, row])) : new Map();
  return {
    warehouses: rows.map((row) => ({ ...toWarehouse(row, { figures: figures.get(row.id), value: showValue }), ...(showStock ? {} : { stock: null }) })),
    showsStock: showStock, showsValue: showValue, capabilities: warehouseCapabilities(c),
  };
}

export function warehouseCapabilities(c) {
  return Object.fromEntries(Object.entries(W).map(([name, permission]) => [name, can(c, permission)]));
}

async function loadWarehouse(client, c, warehouseId, { lock = false } = {}) {
  const id = uuid(warehouseId, "Warehouse");
  if (lock) await client.query(`SELECT id FROM tenant.warehouses WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, id]);
  const row = (await client.query(`${SELECT} WHERE warehouse.organization_id = $1 AND warehouse.id = $2`, [c.organizationId, id])).rows[0];
  if (!row) throw new WarehouseError(404, "Warehouse not found.", "WAREHOUSE_NOT_FOUND");
  // The system "Goods in transit" warehouse is kept by the stock ledger: nobody edits it, its locations or its status.
  if (lock && row.system_role) throw new WarehouseError(409, `${row.name} is maintained by the system and cannot be changed.`, "WAREHOUSE_SYSTEM_LOCKED");
  return row;
}

// The warehouse with its stock figures, incoming and outgoing totals, locations and who may work in it.
export async function getWarehouse(client, c, warehouseId) {
  require(c, W.view, "You do not have permission to view warehouses.");
  const row = await loadWarehouse(client, c, warehouseId);
  const showStock = can(c, W.viewStock);
  const figures = showStock ? (await client.query(`${STOCK_FIGURES} AND balance.warehouse_id = $2 GROUP BY balance.warehouse_id`, [c.organizationId, row.id])).rows[0] : null;
  const warehouse = toWarehouse(row, { figures, value: can(c, W.viewValue) });
  if (!showStock) warehouse.stock = null;
  else {
    const flows = await flowTotals(client, c, row.id);
    warehouse.stock = { ...warehouse.stock, incoming: flows.incoming, outgoing: flows.outgoing };
  }
  return {
    ...warehouse,
    locations: await getWarehouseLocations(client, c, row.id),
    access: await getWarehouseAccess(client, c, row.id),
    // The system "Goods in transit" warehouse is read-only: the stock ledger keeps it.
    capabilities: row.system_role ? Object.fromEntries(Object.entries(warehouseCapabilities(c)).map(([key, allowed]) => [key, ["view", "viewStock", "viewValue"].includes(key) && allowed])) : warehouseCapabilities(c),
    showsStock: showStock,
  };
}

// ------------------------------------------------------------------ writing the warehouse

async function memberOrFail(client, c, userId, field) {
  if (!userId) return null;
  const id = uuid(userId, "User");
  if (!(await client.query(`SELECT 1 FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`, [c.organizationId, id])).rows[0])
    throw issue(field, "Choose an active member of the workspace.");
  return id;
}

function readWarehouse(input, current = null) {
  const pick = (key, column, max) => (has(input, key) ? text(input[key], max) : current?.[column] ?? null);
  const address = input.address ?? {};
  const addr = (key, column, max) => (has(address, key) ? text(address[key], max) : has(input, key) ? text(input[key], max) : current?.[column] ?? null);
  return {
    name: pick("name", "name", 160), description: pick("description", "description", 1000),
    type: has(input, "type") ? (input.type === "transit" ? "transit" : "stores") : current?.warehouse_type === "transit" ? "transit" : "stores",
    line1: addr("line1", "address_line1", 200), line2: addr("line2", "address_line2", 200), city: addr("city", "city", 100), state: addr("state", "state", 100),
    stateCode: addr("stateCode", "state_code", 10), postalCode: addr("postalCode", "postal_code", 20),
    countryCode: (addr("countryCode", "country_code", 2) ?? "").toUpperCase() || null,
    timezone: pick("timezone", "timezone", 64), contactName: pick("contactName", "contact_name", 160), phone: pick("phone", "phone", 40), email: pick("email", "email", 200),
    receiving: flag(input.receivingEnabled, current?.receiving_enabled ?? true), shipping: flag(input.shippingEnabled, current?.shipping_enabled ?? true),
    transfer: flag(input.transferEnabled, current?.transfer_enabled ?? true), returns: flag(input.returnsEnabled, current?.returns_enabled ?? true),
  };
}

function validateWarehouseValues(values) {
  if (!values.name) throw issue("name", "Enter the warehouse name.");
  // A physical warehouse needs its address (documents and GST context use it); a transit warehouse is not a place.
  if (values.type !== "transit") {
    for (const [field, label] of [["line1", "address line"], ["city", "city"], ["state", "state"], ["postalCode", "postal code"], ["countryCode", "country"]])
      if (!values[field]) throw issue(field, `Enter the ${label}.`);
  }
  if (values.countryCode && !/^[A-Z]{2}$/.test(values.countryCode)) throw issue("countryCode", "Use the two-letter country code, such as IN.");
  if (values.email && !EMAIL.test(values.email)) throw issue("email", "Enter a valid email address.");
  if (values.timezone) {
    try { new Intl.DateTimeFormat("en", { timeZone: values.timezone }); } catch { throw issue("timezone", "Choose a valid time zone, such as Asia/Kolkata."); }
  }
}

async function checkCode(client, c, code, exceptId = null) {
  if (!CODE.test(code)) throw issue("code", "Use up to 30 letters, numbers, dots, dashes or slashes, such as PUN-01.");
  const clash = (await client.query(`SELECT name FROM tenant.warehouses WHERE organization_id = $1 AND upper(btrim(code)) = $2 AND ($3::uuid IS NULL OR id <> $3)`,
    [c.organizationId, code, exceptId])).rows[0];
  if (clash) throw issue("code", `${code} is already the code of ${clash.name}.`, "WAREHOUSE_DUPLICATE", 409);
}

async function checkRegistration(client, c, registrationId) {
  if (!registrationId) return null;
  const id = uuid(registrationId, "GST registration");
  if (!(await client.query(`SELECT 1 FROM tenant.tax_registrations WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [c.organizationId, id])).rows[0])
    throw issue("taxRegistrationId", "Choose an active GST registration of the company.");
  return id;
}

// A database refusal (two people saving one code at once) reads like the check's own.
async function guarded(client, run) {
  await client.query("SAVEPOINT warehouse_write");
  try { const result = await run(); await client.query("RELEASE SAVEPOINT warehouse_write"); return result; } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT warehouse_write");
    if (error?.code === "23505" && /code/.test(error.constraint ?? "")) throw issue("code", "Another warehouse with this code was just saved. Reload and try again.", "WAREHOUSE_DUPLICATE", 409);
    if (error?.code === "23505" && /location/.test(error.constraint ?? "")) throw issue("code", "Another location with this code was just saved. Reload and try again.", "WAREHOUSE_LOCATION_DUPLICATE", 409);
    if (error?.code === "23514" && error.constraint === "warehouse_locations_hierarchy") throw issue("parentLocationId", error.message, "WAREHOUSE_LOCATION_HIERARCHY", 409);
    throw error;
  }
}

// input: { code, name, description, type ("stores" | "transit"), address: { line1, line2, city, state, stateCode, postalCode, countryCode },
// timezone, managerUserId, contactName, phone, email, taxRegistrationId, receivingEnabled, shippingEnabled, transferEnabled, returnsEnabled,
// isDefault }. The database gives it its MAIN storage location.
export async function createWarehouse(client, c, input = {}) {
  require(c, W.create, "You do not have permission to create warehouses.");
  const code = normalizeWarehouseCode(input.code);
  const values = readWarehouse(input);
  validateWarehouseValues(values);
  await checkCode(client, c, code);
  const managerId = await memberOrFail(client, c, input.managerUserId, "managerUserId");
  const registrationId = await checkRegistration(client, c, input.taxRegistrationId);
  const timezone = values.timezone ?? (await client.query(`SELECT timezone FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0]?.timezone ?? "Asia/Kolkata";
  const id = await guarded(client, async () => (await client.query(
    `INSERT INTO tenant.warehouses (organization_id, code, name, description, warehouse_type, address_line1, address_line2, city, state, state_code, postal_code, country_code, timezone,
       manager_user_id, contact_name, phone, email, tax_registration_id, receiving_enabled, shipping_enabled, transfer_enabled, returns_enabled, status, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, 'active', $23, $23) RETURNING id`,
    [c.organizationId, code, values.name, values.description, values.type, values.line1, values.line2, values.city, values.state, values.stateCode, values.postalCode, values.countryCode,
      timezone, managerId, values.contactName, values.phone, values.email, registrationId, values.receiving, values.shipping, values.transfer, values.returns, c.userId ?? null])).rows[0].id);
  await history(client, c, id, "created", `Warehouse ${code} created with its MAIN location`, { code, name: values.name });
  // The company's first warehouse becomes its default; otherwise only when asked.
  const hasDefault = (await client.query(`SELECT 1 FROM tenant.warehouses WHERE organization_id = $1 AND is_default`, [c.organizationId])).rows[0];
  if (input.isDefault === true || !hasDefault) await makeDefault(client, c, id);
  return getWarehouse(client, c, id);
}

async function makeDefault(client, c, warehouseId) {
  const previous = (await client.query(`SELECT id, code FROM tenant.warehouses WHERE organization_id = $1 AND is_default`, [c.organizationId])).rows[0];
  if (previous?.id === warehouseId) return;
  await client.query(`UPDATE tenant.warehouses SET is_default = false, version = version + 1 WHERE organization_id = $1 AND is_default`, [c.organizationId]);
  await client.query(`UPDATE tenant.warehouses SET is_default = true, version = version + 1, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, warehouseId, c.userId ?? null]);
  await history(client, c, warehouseId, "default_changed", "Made the company's default warehouse", { from: previous?.code ?? null });
  if (previous) await history(client, c, previous.id, "default_changed", "No longer the company's default warehouse", {});
}

// input: any field of createWarehouse, expectedVersion. A new code needs Change Code; name, address and the rest Edit. Documents keep
// the warehouse details they were made with; no stock moves.
export async function updateWarehouse(client, c, warehouseId, input = {}) {
  require(c, W.edit, "You do not have permission to edit warehouses.");
  const row = await loadWarehouse(client, c, warehouseId, { lock: true });
  if (has(input, "expectedVersion") && input.expectedVersion !== null && input.expectedVersion !== undefined && Number(input.expectedVersion) !== Number(row.version))
    throw new WarehouseError(409, "Someone else changed this warehouse after you opened it. Reload it.", "WAREHOUSE_VERSION_CONFLICT");
  const values = readWarehouse(input, row);
  validateWarehouseValues(values);
  const code = has(input, "code") ? normalizeWarehouseCode(input.code) : row.code;
  if (code !== row.code) {
    require(c, W.changeCode, "You do not have permission to change warehouse codes.");
    await checkCode(client, c, code, row.id);
  }
  const managerId = has(input, "managerUserId") ? await memberOrFail(client, c, input.managerUserId, "managerUserId") : row.manager_user_id;
  const registrationId = has(input, "taxRegistrationId") ? await checkRegistration(client, c, input.taxRegistrationId) : row.tax_registration_id;
  const next = {
    code, name: values.name, description: values.description, warehouse_type: values.type, address_line1: values.line1, address_line2: values.line2, city: values.city, state: values.state,
    state_code: values.stateCode, postal_code: values.postalCode, country_code: values.countryCode, timezone: values.timezone ?? row.timezone, manager_user_id: managerId,
    contact_name: values.contactName, phone: values.phone, email: values.email, tax_registration_id: registrationId, receiving_enabled: values.receiving,
    shipping_enabled: values.shipping, transfer_enabled: values.transfer, returns_enabled: values.returns,
  };
  const changed = Object.keys(next).filter((column) => String(next[column] ?? "") !== String(row[column] ?? ""));
  if (changed.length) {
    await guarded(client, () => client.query(
      `UPDATE tenant.warehouses SET ${changed.map((column, index) => `${column} = $${index + 3}`).join(", ")}, version = version + 1, updated_by = $${changed.length + 3}, updated_at = now()
        WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, ...changed.map((column) => next[column]), c.userId ?? null]));
    const diff = (columns) => Object.fromEntries(columns.filter((column) => changed.includes(column)).map((column) => [column, { from: row[column] ?? null, to: next[column] ?? null }]));
    const reason = text(input.reason, 300);
    if (changed.includes("code")) await history(client, c, row.id, "code_changed", `Code changed from ${row.code} to ${code}`, diff(["code"]), reason);
    const address = ["address_line1", "address_line2", "city", "state", "state_code", "postal_code", "country_code"];
    if (changed.some((column) => address.includes(column))) await history(client, c, row.id, "address_changed", "Address changed (new documents use it; posted documents keep theirs)", diff(address), reason);
    const capabilities = ["receiving_enabled", "shipping_enabled", "transfer_enabled", "returns_enabled"];
    if (changed.some((column) => capabilities.includes(column))) await history(client, c, row.id, "capabilities_changed", "Operations changed", diff(capabilities), reason);
    if (changed.includes("manager_user_id")) await history(client, c, row.id, "manager_changed", "Manager changed", diff(["manager_user_id"]), reason);
    const other = changed.filter((column) => column !== "code" && !address.includes(column) && !capabilities.includes(column) && column !== "manager_user_id");
    if (other.length) await history(client, c, row.id, "updated", `${other.map((column) => column.replace(/_/g, " ")).join(", ")} changed`, diff(other), reason);
  }
  if (input.isDefault === true) {
    if (row.status !== "active") throw issue("isDefault", "Only an active warehouse can be the default.", "WAREHOUSE_INACTIVE", 409);
    await makeDefault(client, c, row.id);
  }
  return getWarehouse(client, c, row.id);
}

export async function setCompanyDefaultWarehouse(client, c, warehouseId) {
  return updateWarehouse(client, c, warehouseId, { isDefault: true });
}

// What stands between a warehouse and Inactive: stock, reservations, open transfers, receipts, deliveries and returns, and being a default
// someone relies on. [] when it can be deactivated.
export async function validateWarehouseForDeactivation(client, c, warehouseId) {
  require(c, W.view, "You do not have permission to view warehouses.");
  const row = await loadWarehouse(client, c, warehouseId);
  const one = async (sql) => (await client.query(sql, [c.organizationId, row.id])).rows[0];
  const blockers = [];
  const stock = await one(`SELECT COALESCE(sum(quantity), 0) AS on_hand, COALESCE(sum(reserved_quantity), 0) AS reserved FROM tenant.stock_balances WHERE organization_id = $1 AND warehouse_id = $2`);
  if (n(stock.on_hand) !== 0) blockers.push({ code: "STOCK", message: `On hand: ${round(stock.on_hand)}.`, quantity: round(stock.on_hand) });
  const reservations = await one(`SELECT count(*)::int AS count, COALESCE(sum(active_quantity), 0) AS quantity FROM tenant.stock_reservations WHERE organization_id = $1 AND warehouse_id = $2 AND status = 'active'`);
  if (reservations.count > 0 || n(stock.reserved) > 0)
    blockers.push({ code: "RESERVATIONS", message: `Reserved: ${round(Math.max(n(stock.reserved), n(reservations.quantity)))} (${reservations.count} active reservation${reservations.count === 1 ? "" : "s"}).`,
      quantity: round(Math.max(n(stock.reserved), n(reservations.quantity))), count: reservations.count });
  const counts = [
    ["TRANSFERS", "open transfer", `SELECT count(*)::int AS count FROM tenant.inventory_transfers WHERE organization_id = $1 AND (source_warehouse_id = $2 OR destination_warehouse_id = $2)
      AND status IN ('draft', 'confirmed', 'dispatched', 'partially_received')`],
    ["RECEIPTS", "draft goods receipt", `SELECT count(*)::int AS count FROM tenant.goods_receipts WHERE organization_id = $1 AND warehouse_id = $2 AND status = 'draft'`],
    ["DELIVERIES", "delivery not yet dispatched", `SELECT count(*)::int AS count FROM tenant.sales_fulfillment_requests WHERE organization_id = $1 AND warehouse_id = $2 AND delivery_status IN ('draft', 'ready')`],
    ["SALES_RETURNS", "sales return not yet received", `SELECT count(*)::int AS count FROM tenant.sales_returns WHERE organization_id = $1 AND warehouse_id = $2 AND status = 'draft'`],
    ["PURCHASE_ORDERS", "open purchase order line delivering here", `SELECT count(*)::int AS count FROM tenant.purchase_order_line_status progress
       JOIN tenant.purchase_order_lines line ON line.organization_id = progress.organization_id AND line.id = progress.purchase_order_line_id
       JOIN tenant.purchase_orders purchase_order ON purchase_order.organization_id = line.organization_id AND purchase_order.id = line.purchase_order_id
      WHERE progress.organization_id = $1 AND line.receiving_warehouse_id = $2 AND purchase_order.status = 'confirmed' AND progress.remaining_to_receive > 0`],
  ];
  for (const [code, label, sql] of counts) {
    const found = await one(sql);
    if (found.count > 0) blockers.push({ code, message: `${found.count} ${label}${found.count === 1 ? "" : "s"}.`, count: found.count });
  }
  for (const [code, label, sql] of [["SALES_DEFAULT", "Sales", `SELECT 1 FROM tenant.sales_settings WHERE organization_id = $1 AND default_warehouse_id = $2`],
    ["PROCUREMENT_DEFAULT", "Procurement", `SELECT 1 FROM tenant.procurement_settings WHERE organization_id = $1 AND default_warehouse_id = $2`]])
    if (await one(sql)) blockers.push({ code, message: `It is the default warehouse in ${label} settings. Choose another there first.` });
  return blockers;
}

// Deactivate: only an empty warehouse with nothing open (the blockers above); the company default needs a replacement
// (replacementDefaultId). Users who preferred it lose that preference. Reactivate: any time. History stays.
export async function setWarehouseStatus(client, c, warehouseId, status, input = {}) {
  require(c, W.status, "You do not have permission to activate or deactivate warehouses.");
  if (!["active", "inactive"].includes(status)) throw issue("status", "Choose Active or Inactive.");
  const row = await loadWarehouse(client, c, warehouseId, { lock: true });
  if (row.status === status) throw new WarehouseError(409, `This warehouse is already ${status}.`, "WAREHOUSE_STATUS_UNCHANGED");
  const reason = text(input.reason, 300);
  if (status === "inactive") {
    const blockers = await validateWarehouseForDeactivation(client, c, row.id);
    if (blockers.length)
      throw new WarehouseError(409, `This warehouse cannot be deactivated. ${blockers.map((entry) => entry.message).join(" ")}`, "WAREHOUSE_NOT_EMPTY", { blockers });
    if (row.is_default) {
      if (!input.replacementDefaultId) throw issue("replacementDefaultId", "This is the company's default warehouse. Choose the warehouse that replaces it.", "WAREHOUSE_DEFAULT_REPLACEMENT_REQUIRED", 409);
      const replacement = await loadWarehouse(client, c, input.replacementDefaultId);
      if (replacement.id === row.id || replacement.status !== "active") throw issue("replacementDefaultId", "Choose another active warehouse as the default.", "WAREHOUSE_DEFAULT_REPLACEMENT_REQUIRED", 409);
      await makeDefault(client, c, replacement.id);
    }
    await client.query(`DELETE FROM tenant.user_warehouse_defaults WHERE organization_id = $1 AND warehouse_id = $2`, [c.organizationId, row.id]);
  }
  await client.query(`UPDATE tenant.warehouses SET status = $3, version = version + 1, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, status, c.userId ?? null]);
  await history(client, c, row.id, status === "active" ? "activated" : "deactivated", status === "active" ? "Reactivated" : "Deactivated", { from: row.status, to: status }, reason);
  return getWarehouse(client, c, row.id);
}

// Only a warehouse nothing has ever used can be deleted (it is then gone with its locations); anything else is deactivated.
export async function deleteWarehouse(client, c, warehouseId) {
  require(c, W.status, "You do not have permission to delete warehouses.");
  const row = await loadWarehouse(client, c, warehouseId, { lock: true });
  const references = [
    ["stock movements", "SELECT 1 FROM tenant.stock_movements WHERE organization_id = $1 AND warehouse_id = $2"],
    ["stock balances", "SELECT 1 FROM tenant.stock_balances WHERE organization_id = $1 AND warehouse_id = $2"],
    ["transfers", "SELECT 1 FROM tenant.inventory_transfers WHERE organization_id = $1 AND (source_warehouse_id = $2 OR destination_warehouse_id = $2)"],
    ["purchase orders", "SELECT 1 FROM tenant.purchase_order_lines WHERE organization_id = $1 AND receiving_warehouse_id = $2"],
    ["purchase orders", "SELECT 1 FROM tenant.purchase_orders WHERE organization_id = $1 AND default_warehouse_id = $2"],
    ["goods receipts", "SELECT 1 FROM tenant.goods_receipts WHERE organization_id = $1 AND warehouse_id = $2"],
    ["sales orders", "SELECT 1 FROM tenant.sales_order_lines WHERE organization_id = $1 AND warehouse_id = $2"],
    ["quotations", "SELECT 1 FROM tenant.sales_quotation_lines WHERE organization_id = $1 AND warehouse_id = $2"],
    ["deliveries", "SELECT 1 FROM tenant.sales_fulfillment_requests WHERE organization_id = $1 AND warehouse_id = $2"],
    ["sales returns", "SELECT 1 FROM tenant.sales_returns WHERE organization_id = $1 AND warehouse_id = $2"],
    ["reservations", "SELECT 1 FROM tenant.stock_reservations WHERE organization_id = $1 AND warehouse_id = $2"],
    ["Sales settings", "SELECT 1 FROM tenant.sales_settings WHERE organization_id = $1 AND default_warehouse_id = $2"],
    ["Procurement settings", "SELECT 1 FROM tenant.procurement_settings WHERE organization_id = $1 AND default_warehouse_id = $2"],
  ];
  const used = [];
  for (const [label, sql] of references) if (!used.includes(label) && (await client.query(`${sql} LIMIT 1`, [c.organizationId, row.id])).rows[0]) used.push(label);
  if (used.length) throw new WarehouseError(409, `This warehouse is used by ${used.join(", ")}. Deactivate it instead.`, "WAREHOUSE_IN_USE", { references: used });
  if (row.is_default) throw new WarehouseError(409, "This is the company's default warehouse. Make another warehouse the default first.", "WAREHOUSE_DEFAULT_REPLACEMENT_REQUIRED");
  await client.query(`DELETE FROM tenant.warehouses WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id]);
  return { deleted: true };
}

// ------------------------------------------------------------------ locations

function toLocation(row, mainId) {
  return {
    id: row.id, warehouseId: row.warehouse_id, code: row.code, name: row.name, purpose: row.purpose, purposeLabel: LOCATION_PURPOSES.find((entry) => entry.code === row.purpose)?.label ?? row.purpose,
    structure: row.location_type, parentLocationId: row.parent_location_id, parentCode: row.parent_code ?? null, allowStock: row.allow_stock, status: row.status, isActive: row.status === "active",
    isMain: row.id === mainId, isDefaultStorage: row.is_default_storage, isDefaultReceiving: row.is_default_receiving, isDefaultReturns: row.is_default_returns,
    isDefaultShipping: row.is_default_shipping, onHand: round(row.on_hand), version: Number(row.version ?? 1),
    disposition: row.disposition, dispositionLabel: LOCATION_DISPOSITIONS.find((entry) => entry.code === row.disposition)?.label ?? row.disposition,
    allowAllocation: row.allow_allocation, allocatable: row.status === "active" && row.allow_stock && row.disposition === "available" && row.allow_allocation,
  };
}

// The warehouse's locations, parents first, each with the stock in it (MAIN holds the stock with no location in the ledger).
export async function getWarehouseLocations(client, c, warehouseId) {
  require(c, W.view, "You do not have permission to view warehouses.");
  const id = uuid(warehouseId, "Warehouse");
  const { rows } = await client.query(
    `SELECT location.*, parent.code AS parent_code,
            (SELECT COALESCE(sum(balance.quantity), 0) FROM tenant.stock_balances balance WHERE balance.organization_id = location.organization_id AND balance.warehouse_id = location.warehouse_id
               AND (balance.warehouse_location_id = location.id OR (location.is_default_storage AND balance.warehouse_location_id IS NULL))) AS on_hand
       FROM tenant.warehouse_locations location
       LEFT JOIN tenant.warehouse_locations parent ON parent.organization_id = location.organization_id AND parent.id = location.parent_location_id
      WHERE location.organization_id = $1 AND location.warehouse_id = $2
      ORDER BY location.is_default_storage DESC, location.status, COALESCE(parent.code, location.code), location.parent_location_id NULLS FIRST, location.code`, [c.organizationId, id]);
  const mainId = rows.find((row) => row.is_default_storage)?.id ?? null;
  const showStock = can(c, W.viewStock);
  return rows.map((row) => ({ ...toLocation(row, mainId), ...(showStock ? {} : { onHand: null }) }));
}

async function loadLocation(client, c, locationId, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, uuid(locationId, "Location")])).rows[0];
  if (!row) throw new WarehouseError(404, "Location not found.", "WAREHOUSE_LOCATION_NOT_FOUND");
  return row;
}

function readLocation(input, current = null) {
  const purpose = has(input, "purpose") ? String(input.purpose ?? "") : current?.purpose ?? "storage";
  const structure = has(input, "structure") ? String(input.structure ?? "") : current?.location_type ?? "zone";
  if (!LOCATION_PURPOSES.some((entry) => entry.code === purpose)) throw issue("purpose", "Choose what the location is for.");
  if (!LOCATION_STRUCTURES.includes(structure) && structure !== "quality") throw issue("structure", "Choose zone, aisle, rack, bin, staging or other.");
  // A quality-hold location holds quality-hold stock unless another held disposition is chosen; held stock never allocates.
  const disposition = has(input, "disposition") ? String(input.disposition ?? "") : current?.disposition ?? (purpose === "quality_hold" ? "quality_hold" : "available");
  if (!LOCATION_DISPOSITIONS.some((entry) => entry.code === disposition)) throw issue("disposition", "Choose available, quality hold, quarantined or damaged.");
  if (purpose === "quality_hold" && disposition === "available") throw issue("disposition", "A quality-hold location holds quality-hold, quarantined or damaged stock.");
  return {
    name: has(input, "name") ? text(input.name, 120) : current?.name ?? null, purpose,
    // A quality-hold location is a quality location for Inventory: its stock is never available to sell.
    structure: purpose === "quality_hold" ? "quality" : structure === "quality" ? "zone" : structure,
    allowStock: flag(input.allowStock, current?.allow_stock ?? true), disposition,
    allowAllocation: disposition === "available" && flag(input.allowAllocation, current?.allow_allocation ?? true),
  };
}

async function checkParent(client, c, warehouseId, parentId, selfId = null) {
  if (!parentId) return null;
  const parent = await loadLocation(client, c, parentId);
  if (parent.warehouse_id !== warehouseId) throw issue("parentLocationId", "Choose a parent location in the same warehouse.", "WAREHOUSE_LOCATION_OTHER_WAREHOUSE", 409);
  if (selfId && parent.id === selfId) throw issue("parentLocationId", "A location cannot be its own parent.", "WAREHOUSE_LOCATION_HIERARCHY", 409);
  return parent.id;
}

// input: { code, name, purpose, structure, parentLocationId, allowStock }
export async function createWarehouseLocation(client, c, warehouseId, input = {}) {
  require(c, W.manageLocations, "You do not have permission to manage warehouse locations.");
  const warehouse = await loadWarehouse(client, c, warehouseId, { lock: true });
  const code = normalizeWarehouseCode(input.code);
  if (!LOCATION_CODE.test(code)) throw issue("code", "Use up to 30 letters, numbers, dots, dashes or slashes, such as RACK-A01.");
  const values = readLocation(input);
  if (!values.name) throw issue("name", "Enter the location name.");
  const parentId = await checkParent(client, c, warehouse.id, input.parentLocationId ? input.parentLocationId : null);
  if ((await client.query(`SELECT 1 FROM tenant.warehouse_locations WHERE organization_id = $1 AND warehouse_id = $2 AND upper(btrim(code)) = $3`, [c.organizationId, warehouse.id, code])).rows[0])
    throw issue("code", `${warehouse.code} already has a location ${code}.`, "WAREHOUSE_LOCATION_DUPLICATE", 409);
  const id = await guarded(client, async () => (await client.query(
    `INSERT INTO tenant.warehouse_locations (organization_id, warehouse_id, parent_location_id, name, code, location_type, purpose, allow_stock, disposition, allow_allocation, status,
       created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11, $11) RETURNING id`,
    [c.organizationId, warehouse.id, parentId, values.name, code, values.structure, values.purpose, values.allowStock, values.disposition, values.allowAllocation, c.userId ?? null])).rows[0].id);
  await history(client, c, warehouse.id, "location_added", `Location ${code} added`, { code, purpose: values.purpose });
  return (await getWarehouseLocations(client, c, warehouse.id)).find((location) => location.id === id);
}

// input: { name, purpose, structure, parentLocationId, allowStock, expectedVersion }. The code and MAIN's purpose are fixed.
export async function updateWarehouseLocation(client, c, locationId, input = {}) {
  require(c, W.manageLocations, "You do not have permission to manage warehouse locations.");
  const row = await loadLocation(client, c, locationId, { lock: true });
  if (has(input, "expectedVersion") && input.expectedVersion !== null && input.expectedVersion !== undefined && Number(input.expectedVersion) !== Number(row.version))
    throw new WarehouseError(409, "Someone else changed this location after you opened it. Reload it.", "WAREHOUSE_LOCATION_VERSION_CONFLICT");
  if (has(input, "code") && normalizeWarehouseCode(input.code) !== row.code) throw issue("code", "A location's code cannot change. Add a new location instead.", "WAREHOUSE_LOCATION_CODE_LOCKED", 409);
  const values = readLocation(input, row);
  if (!values.name) throw issue("name", "Enter the location name.");
  if (row.is_default_storage && (values.purpose !== "storage" || !values.allowStock || values.disposition !== "available" || !values.allowAllocation))
    throw issue("purpose", "MAIN is the default storage location: it stays a storage location of available, allocatable stock.", "WAREHOUSE_MAIN_LOCKED", 409);
  // Reclassifying a location would silently reclassify the stock in it: move the stock (a recorded transfer) first.
  if (values.disposition !== row.disposition || values.allowAllocation !== row.allow_allocation) {
    const held = (await client.query(`SELECT COALESCE(sum(quantity), 0) AS q FROM tenant.stock_balances WHERE organization_id = $1 AND warehouse_location_id = $2`, [c.organizationId, row.id])).rows[0];
    if (n(held.q) !== 0) throw issue("disposition", `${round(held.q)} units are in ${row.code}. Move them before changing what the location holds.`, "WAREHOUSE_LOCATION_HAS_STOCK", 409);
  }
  const parentId = has(input, "parentLocationId") ? await checkParent(client, c, row.warehouse_id, input.parentLocationId || null, row.id) : row.parent_location_id;
  if (!values.allowStock && row.allow_stock) {
    const stock = (await client.query(`SELECT COALESCE(sum(quantity), 0) AS q FROM tenant.stock_balances WHERE organization_id = $1 AND warehouse_location_id = $2`, [c.organizationId, row.id])).rows[0];
    if (n(stock.q) !== 0) throw issue("allowStock", "Stock is in this location. Move it before the location stops holding stock.", "WAREHOUSE_LOCATION_HAS_STOCK", 409);
  }
  await guarded(client, () => client.query(
    `UPDATE tenant.warehouse_locations SET name = $3, purpose = $4, location_type = $5, allow_stock = $6, parent_location_id = $7, disposition = $9, allow_allocation = $10, version = version + 1,
       updated_by = $8, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, values.name, values.purpose, values.structure, values.allowStock, parentId, c.userId ?? null, values.disposition, values.allowAllocation]));
  await history(client, c, row.warehouse_id, "location_changed", `Location ${row.code} changed`, { name: { from: row.name, to: values.name }, purpose: { from: row.purpose, to: values.purpose } });
  return (await getWarehouseLocations(client, c, row.warehouse_id)).find((location) => location.id === row.id);
}

// Deactivate: never MAIN, a default location (choose another first), one with stock or with active locations inside it.
export async function setWarehouseLocationStatus(client, c, locationId, status) {
  require(c, W.manageLocations, "You do not have permission to manage warehouse locations.");
  if (!["active", "inactive"].includes(status)) throw issue("status", "Choose Active or Inactive.");
  const row = await loadLocation(client, c, locationId, { lock: true });
  if (row.status === status) throw new WarehouseError(409, `This location is already ${status}.`, "WAREHOUSE_LOCATION_STATUS_UNCHANGED");
  if (status === "inactive") {
    if (row.is_default_storage) throw new WarehouseError(409, "MAIN is the warehouse's default storage location and stays active.", "WAREHOUSE_MAIN_LOCKED");
    if (row.is_default_receiving || row.is_default_returns || row.is_default_shipping)
      throw new WarehouseError(409, "This is a default location of the warehouse. Choose another default first.", "WAREHOUSE_LOCATION_IS_DEFAULT");
    const stock = (await client.query(`SELECT COALESCE(sum(quantity), 0) AS q FROM tenant.stock_balances WHERE organization_id = $1 AND warehouse_location_id = $2`, [c.organizationId, row.id])).rows[0];
    if (n(stock.q) !== 0) throw new WarehouseError(409, `${round(stock.q)} units are in this location. Move them first.`, "WAREHOUSE_LOCATION_HAS_STOCK");
    // Reservations allocated to this very location must be reallocated or released first (warehouse-level reservations are not affected).
    const held = (await client.query(`SELECT count(*)::int AS count FROM tenant.stock_reservations WHERE organization_id = $1 AND warehouse_location_id = $2 AND status = 'active'`, [c.organizationId, row.id])).rows[0];
    if (held.count) throw new WarehouseError(409, `${held.count} active reservation${held.count === 1 ? " is" : "s are"} allocated to this location. Reallocate or release them first.`, "WAREHOUSE_LOCATION_HAS_RESERVATIONS");
    if ((await client.query(`SELECT 1 FROM tenant.warehouse_locations WHERE organization_id = $1 AND parent_location_id = $2 AND status = 'active' LIMIT 1`, [c.organizationId, row.id])).rows[0])
      throw new WarehouseError(409, "Locations inside this one are still active. Deactivate them first.", "WAREHOUSE_LOCATION_HAS_CHILDREN");
  }
  await client.query(`UPDATE tenant.warehouse_locations SET status = $3, version = version + 1, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, status, c.userId ?? null]);
  await history(client, c, row.warehouse_id, status === "active" ? "location_activated" : "location_deactivated", `Location ${row.code} ${status === "active" ? "reactivated" : "deactivated"}`, {});
  return (await getWarehouseLocations(client, c, row.warehouse_id)).find((location) => location.id === row.id);
}

// kind: receiving | returns | shipping; locationId null clears it (MAIN is then used).
export async function setDefaultWarehouseLocation(client, c, warehouseId, kind, locationId) {
  require(c, W.manageLocations, "You do not have permission to manage warehouse locations.");
  const column = { receiving: "is_default_receiving", returns: "is_default_returns", shipping: "is_default_shipping" }[kind];
  if (!column) throw issue("kind", "Choose receiving, returns or shipping.");
  const warehouse = await loadWarehouse(client, c, warehouseId, { lock: true });
  let location = null;
  if (locationId) {
    location = await loadLocation(client, c, locationId);
    if (location.warehouse_id !== warehouse.id) throw issue("locationId", "Choose a location of this warehouse.", "WAREHOUSE_LOCATION_OTHER_WAREHOUSE", 409);
    if (location.status !== "active" || !location.allow_stock) throw issue("locationId", "Choose an active location that holds stock.", "WAREHOUSE_LOCATION_INVALID", 409);
  }
  await client.query(`UPDATE tenant.warehouse_locations SET ${column} = false WHERE organization_id = $1 AND warehouse_id = $2 AND ${column}`, [c.organizationId, warehouse.id]);
  if (location) await client.query(`UPDATE tenant.warehouse_locations SET ${column} = true, version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, location.id]);
  await history(client, c, warehouse.id, "location_changed", `Default ${kind} location: ${location?.code ?? "MAIN"}`, { kind, location: location?.code ?? null });
  return getWarehouseLocations(client, c, warehouse.id);
}

// ------------------------------------------------------------------ access and defaults

export async function getWarehouseAccess(client, c, warehouseId) {
  const { rows } = await client.query(
    `SELECT access.user_id, access.operations, users.full_name, users.email FROM tenant.warehouse_user_access access JOIN public.users users ON users.id = access.user_id
      WHERE access.organization_id = $1 AND access.warehouse_id = $2 ORDER BY users.full_name`, [c.organizationId, uuid(warehouseId, "Warehouse")]);
  return rows.map((row) => ({ userId: row.user_id, name: row.full_name, email: row.email, operations: row.operations }));
}

// entries: [{ userId, operations }] — the full list for the warehouse (empty: open to everyone with the permissions).
export async function setWarehouseAccess(client, c, warehouseId, entries = []) {
  require(c, W.manageAccess, "You do not have permission to manage warehouse access.");
  const warehouse = await loadWarehouse(client, c, warehouseId, { lock: true });
  const list = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const userId = await memberOrFail(client, c, entry.userId, "userId");
    const operations = [...new Set((Array.isArray(entry.operations) && entry.operations.length ? entry.operations : WAREHOUSE_OPERATIONS).map(String))];
    if (operations.some((operation) => !WAREHOUSE_OPERATIONS.includes(operation))) throw issue("operations", "Choose from receive, ship, transfer, adjust, opening, purchase_return and sales_return.");
    list.push({ userId, operations });
  }
  const before = await getWarehouseAccess(client, c, warehouse.id);
  await client.query(`DELETE FROM tenant.warehouse_user_access WHERE organization_id = $1 AND warehouse_id = $2`, [c.organizationId, warehouse.id]);
  for (const entry of list)
    await client.query(`INSERT INTO tenant.warehouse_user_access (organization_id, warehouse_id, user_id, operations, created_by) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (organization_id, warehouse_id, user_id) DO UPDATE SET operations = EXCLUDED.operations`, [c.organizationId, warehouse.id, entry.userId, entry.operations, c.userId ?? null]);
  await history(client, c, warehouse.id, "access_changed", list.length ? `Access: ${list.length} ${list.length === 1 ? "person" : "people"}` : "Access opened to everyone with the permissions",
    { from: before.map((entry) => entry.name), to: list.map((entry) => entry.userId) });
  return getWarehouseAccess(client, c, warehouse.id);
}

// May this user do `operation` in this warehouse? Owners and administrators always; otherwise, when the user is listed on some warehouses
// or the warehouse lists some people, only with a row for this warehouse that includes the operation.
export async function canUseWarehouse(client, c, warehouseId, operation) {
  if (c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug))) return true;
  if (!c.userId) return true;
  const row = (await client.query(
    `SELECT (SELECT operations FROM tenant.warehouse_user_access WHERE organization_id = $1 AND warehouse_id = $2 AND user_id = $3) AS operations,
            EXISTS (SELECT 1 FROM tenant.warehouse_user_access WHERE organization_id = $1 AND user_id = $3) AS user_listed,
            EXISTS (SELECT 1 FROM tenant.warehouse_user_access WHERE organization_id = $1 AND warehouse_id = $2) AS warehouse_listed`,
    [c.organizationId, warehouseId, c.userId])).rows[0];
  if (!row.user_listed && !row.warehouse_listed) return true;
  return Array.isArray(row.operations) && (!operation || row.operations.includes(operation));
}

export async function validateUserWarehouseAccess(client, c, warehouseId, operation) {
  if (!(await canUseWarehouse(client, c, warehouseId, operation)))
    throw new WarehouseError(403, `You may not ${WAREHOUSE_OPERATION_LABELS[operation]?.toLowerCase() ?? "work"} in this warehouse.`, "WAREHOUSE_FORBIDDEN");
}

// The one check before any stock operation: the warehouse (and location) of this organization, active, allowing the operation, and the
// user allowed in it. Returns { warehouse, locationId } where locationId is the ledger's location (MAIN becomes no location).
// options: { locationId, allowInactive, label, skipCapability }
export async function validateWarehouseOperation(client, c, warehouseId, operation, { locationId = null, allowInactive = false, label = "Warehouse", skipCapability = false } = {}) {
  if (!warehouseId) throw new WarehouseError(400, `${label}: choose the warehouse.`, "WAREHOUSE_REQUIRED");
  const warehouse = (await client.query(`SELECT * FROM tenant.warehouses WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(warehouseId, label)])).rows[0];
  if (!warehouse) throw new WarehouseError(404, `${label}: the warehouse was not found.`, "WAREHOUSE_NOT_FOUND");
  if (warehouse.status !== "active" && !allowInactive) throw new WarehouseError(409, `${label}: ${warehouse.name} is inactive.`, "WAREHOUSE_INACTIVE");
  // Goods in transit move only by dispatching and receiving transfers.
  if (warehouse.system_role) throw new WarehouseError(409, `${label}: ${warehouse.name} holds goods in transit; stock reaches it only by dispatching a transfer.`, "WAREHOUSE_SYSTEM_LOCKED");
  const capability = CAPABILITY[operation];
  // Shipping also needs a warehouse type that fulfils sales (never transit, work in progress, virtual or returns).
  if (capability && !skipCapability && (!warehouse[capability] || (operation === "ship" && warehouse.sales_fulfillment === false)))
    throw new WarehouseError(409, `${label}: ${warehouse.name} does not allow ${CAPABILITY_LABEL[capability]}.`, "WAREHOUSE_OPERATION_DISABLED", { capability });
  await validateUserWarehouseAccess(client, c, warehouse.id, operation);
  return { warehouse, locationId: await ledgerLocation(client, c.organizationId, warehouse.id, locationId, { label }) };
}

// The location as the ledger records it: the warehouse's MAIN is "no location"; any other location must be an active location of this
// warehouse that holds stock.
export async function ledgerLocation(client, organizationId, warehouseId, locationId, { label = "Location" } = {}) {
  if (!locationId) return null;
  const location = (await client.query(`SELECT id, warehouse_id, status, allow_stock, is_default_storage FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = $2`,
    [organizationId, uuid(locationId, label)])).rows[0];
  if (!location || location.warehouse_id !== warehouseId) throw new WarehouseError(409, `${label}: the location is not in that warehouse.`, "WAREHOUSE_LOCATION_OTHER_WAREHOUSE");
  if (location.is_default_storage) return null;
  if (location.status !== "active") throw new WarehouseError(409, `${label}: the location is inactive.`, "WAREHOUSE_LOCATION_INVALID");
  if (!location.allow_stock) throw new WarehouseError(409, `${label}: the location does not hold stock (choose a bin inside it).`, "WAREHOUSE_LOCATION_NO_STOCK");
  return location.id;
}

// A warehouse's default location for receiving or returns (null: MAIN).
export async function defaultLocationOf(client, organizationId, warehouseId, kind) {
  const column = { receiving: "is_default_receiving", returns: "is_default_returns", shipping: "is_default_shipping" }[kind];
  if (!column || !warehouseId) return null;
  return (await client.query(`SELECT id FROM tenant.warehouse_locations WHERE organization_id = $1 AND warehouse_id = $2 AND ${column} AND status = 'active' AND NOT is_default_storage`,
    [organizationId, warehouseId])).rows[0]?.id ?? null;
}

// The warehouse a new document starts with: the user's preferred one, else the company default — active and allowed for the user.
export async function resolveDefaultWarehouse(client, c, operation = null) {
  const candidates = (await client.query(
    `SELECT warehouse.id, warehouse.code, warehouse.name, preference.warehouse_id IS NOT NULL AS preferred FROM tenant.warehouses warehouse
       LEFT JOIN tenant.user_warehouse_defaults preference ON preference.organization_id = warehouse.organization_id AND preference.warehouse_id = warehouse.id AND preference.user_id = $2
      WHERE warehouse.organization_id = $1 AND warehouse.status = 'active' AND (preference.warehouse_id IS NOT NULL OR warehouse.is_default)
      ORDER BY (preference.warehouse_id IS NOT NULL) DESC`, [c.organizationId, c.userId ?? null])).rows;
  for (const candidate of candidates) if (await canUseWarehouse(client, c, candidate.id, operation))
    return { warehouseId: candidate.id, code: candidate.code, name: candidate.name, source: candidate.preferred ? "user" : "company" };
  return null;
}

// The caller's own preferred warehouse (null clears it).
export async function setUserDefaultWarehouse(client, c, warehouseId) {
  if (!c.userId) throw new WarehouseError(400, "Sign in to choose a preferred warehouse.", "WAREHOUSE_VALIDATION");
  if (!warehouseId) {
    await client.query(`DELETE FROM tenant.user_warehouse_defaults WHERE organization_id = $1 AND user_id = $2`, [c.organizationId, c.userId]);
    return null;
  }
  const warehouse = await loadWarehouse(client, c, warehouseId);
  if (warehouse.status !== "active") throw issue("warehouseId", "Choose an active warehouse.", "WAREHOUSE_INACTIVE", 409);
  if (!(await canUseWarehouse(client, c, warehouse.id, null))) throw new WarehouseError(403, "You may not work in this warehouse.", "WAREHOUSE_FORBIDDEN");
  await client.query(`INSERT INTO tenant.user_warehouse_defaults (organization_id, user_id, warehouse_id) VALUES ($1, $2, $3)
    ON CONFLICT (organization_id, user_id) DO UPDATE SET warehouse_id = EXCLUDED.warehouse_id, updated_at = now()`, [c.organizationId, c.userId, warehouse.id]);
  return resolveDefaultWarehouse(client, c);
}

// ------------------------------------------------------------------ stock views (read from Inventory)

function requireStock(c) { require(c, W.viewStock, "You do not have permission to view warehouse stock."); }

// filters: search (SKU, name), categoryId, locationId, batchId, status (available | reserved | quality_hold)
export async function getWarehouseItemBalances(client, c, warehouseId, filters = {}) {
  requireStock(c);
  const warehouse = await loadWarehouse(client, c, warehouseId);
  const values = [c.organizationId, warehouse.id];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["balance.organization_id = $1", "balance.warehouse_id = $2"];
  const term = text(filters.search);
  if (term) where.push(`lower(concat_ws(' ', item.code, item.name)) LIKE ${bind(`%${term.toLowerCase()}%`)}`);
  if (filters.categoryId && UUID.test(filters.categoryId)) where.push(`item.group_id = ${bind(filters.categoryId)}`);
  if (filters.locationId && UUID.test(filters.locationId))
    where.push(filters.locationId === warehouse.main_location_id ? "balance.warehouse_location_id IS NULL" : `balance.warehouse_location_id = ${bind(filters.locationId)}`);
  if (filters.batchId && UUID.test(filters.batchId)) where.push(`balance.batch_id = ${bind(filters.batchId)}`);
  const value = can(c, W.viewValue);
  const { rows } = await client.query(
    `SELECT item.id, item.code, item.name, category.name AS category_name, uom.code AS uom, sum(balance.quantity) AS on_hand, sum(balance.reserved_quantity) AS reserved,
            sum(CASE WHEN ${restrictedStockSql("location", "batch")} THEN balance.quantity ELSE 0 END) AS quality_hold, sum(balance.quantity * balance.average_cost) AS value
       FROM tenant.stock_balances balance
       JOIN tenant.items item ON item.organization_id = balance.organization_id AND item.id = balance.item_id
       LEFT JOIN tenant.item_groups category ON category.organization_id = item.organization_id AND category.id = item.group_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = item.organization_id AND uom.id = item.uom_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
      WHERE ${where.join(" AND ")} GROUP BY item.id, item.code, item.name, category.name, uom.code HAVING sum(balance.quantity) <> 0 OR sum(balance.reserved_quantity) <> 0 ORDER BY item.code LIMIT 2000`, values);
  const items = rows.map((row) => ({
    itemId: row.id, sku: row.code, name: row.name, category: row.category_name, uom: row.uom, onHand: round(row.on_hand), reserved: round(row.reserved), qualityHold: round(row.quality_hold),
    available: round(n(row.on_hand) - n(row.reserved) - n(row.quality_hold)), ...(value ? { value: round(row.value) } : {}),
  })).filter((row) => !filters.status || (filters.status === "reserved" ? row.reserved > 0 : filters.status === "quality_hold" ? row.qualityHold > 0 : row.available > 0));
  return { warehouseId: warehouse.id, items, showsValue: value };
}

// filters: itemId, movementType, locationId, reference, from, to
export async function getWarehouseMovements(client, c, warehouseId, filters = {}) {
  requireStock(c);
  const warehouse = await loadWarehouse(client, c, warehouseId);
  const values = [c.organizationId, warehouse.id];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["movement.organization_id = $1", "movement.warehouse_id = $2"];
  if (filters.itemId && UUID.test(filters.itemId)) where.push(`movement.item_id = ${bind(filters.itemId)}`);
  if (text(filters.movementType)) where.push(`movement.movement_type = ${bind(text(filters.movementType))}`);
  if (filters.locationId && UUID.test(filters.locationId))
    where.push(filters.locationId === warehouse.main_location_id ? "movement.warehouse_location_id IS NULL" : `movement.warehouse_location_id = ${bind(filters.locationId)}`);
  if (text(filters.reference)) where.push(`(movement.movement_number ILIKE ${bind(`%${text(filters.reference)}%`)} OR movement.reason ILIKE $${values.length})`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.from ?? ""))) where.push(`movement.occurred_at >= ${bind(filters.from)}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.to ?? ""))) where.push(`movement.occurred_at < ${bind(filters.to)}::date + 1`);
  const { rows } = await client.query(
    `SELECT movement.id, movement.movement_number, movement.movement_type, movement.quantity, movement.reference_type, movement.reason, movement.occurred_at, item.code AS sku, item.name AS item_name,
            COALESCE(location.code, 'MAIN') AS location, batch.batch_number, serial.serial_number
       FROM tenant.stock_movements movement
       JOIN tenant.items item ON item.organization_id = movement.organization_id AND item.id = movement.item_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = movement.organization_id AND location.id = movement.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = movement.organization_id AND batch.id = movement.batch_id
       LEFT JOIN tenant.stock_serials serial ON serial.organization_id = movement.organization_id AND serial.id = movement.serial_id
      WHERE ${where.join(" AND ")} ORDER BY movement.occurred_at DESC, movement.movement_number DESC LIMIT 500`, values);
  return rows.map((row) => ({
    id: row.id, number: row.movement_number, type: row.movement_type, referenceType: row.reference_type, reference: row.reason, occurredAt: row.occurred_at, sku: row.sku, item: row.item_name,
    in: n(row.quantity) > 0 ? round(row.quantity) : null, out: n(row.quantity) < 0 ? round(-n(row.quantity)) : null, location: row.location, batch: row.batch_number, serial: row.serial_number,
  }));
}

// Incoming (expected purchase receipts, inbound transfers, sales returns not yet received) and outgoing (reservations, deliveries not yet
// dispatched, outbound transfers, purchase returns not yet posted), each line by line. Never added to on hand.
export async function getWarehouseIncoming(client, c, warehouseId) {
  requireStock(c);
  const warehouse = await loadWarehouse(client, c, warehouseId);
  const rows = async (sql) => (await client.query(sql, [c.organizationId, warehouse.id])).rows;
  const purchase = await rows(
    `SELECT purchase_order.id, purchase_order.purchase_order_number AS reference, item.code AS sku, item.name AS item, progress.remaining_to_receive * line.conversion_factor AS quantity,
            line.expected_delivery_date AS expected FROM tenant.purchase_order_line_status progress
       JOIN tenant.purchase_order_lines line ON line.organization_id = progress.organization_id AND line.id = progress.purchase_order_line_id
       JOIN tenant.purchase_orders purchase_order ON purchase_order.organization_id = line.organization_id AND purchase_order.id = line.purchase_order_id
       JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.product_id
      WHERE progress.organization_id = $1 AND COALESCE(line.receiving_warehouse_id, purchase_order.default_warehouse_id) = $2 AND purchase_order.status = 'confirmed'
        AND progress.remaining_to_receive > 0 ORDER BY line.expected_delivery_date NULLS LAST LIMIT 500`);
  const transfers = await rows(
    `SELECT transfer.id, transfer.document_number AS reference, item.code AS sku, item.name AS item, source.name AS other, transfer.expected_arrival_date AS expected,
            CASE WHEN transfer.status = 'confirmed' THEN line.base_quantity ELSE line.dispatched_base_quantity - line.received_base_quantity - line.lost_base_quantity END AS quantity
       FROM tenant.inventory_transfers transfer
       JOIN tenant.inventory_transfer_lines line ON line.organization_id = transfer.organization_id AND line.transfer_id = transfer.id
       JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
       JOIN tenant.warehouses source ON source.organization_id = transfer.organization_id AND source.id = transfer.source_warehouse_id
      WHERE transfer.organization_id = $1 AND transfer.destination_warehouse_id = $2 AND transfer.transfer_type = 'warehouse'
        AND transfer.status IN ('confirmed', 'dispatched', 'partially_received') LIMIT 500`);
  const returns = await rows(
    `SELECT sales_return.id, sales_return.return_number AS reference, item.code AS sku, item.name AS item, line.base_quantity AS quantity FROM tenant.sales_returns sales_return
       JOIN tenant.sales_return_lines line ON line.organization_id = sales_return.organization_id AND line.sales_return_id = sales_return.id
       JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
      WHERE sales_return.organization_id = $1 AND sales_return.warehouse_id = $2 AND sales_return.status = 'draft' LIMIT 500`);
  const shape = (kind) => (row) => ({ kind, id: row.id, reference: row.reference, sku: row.sku, item: row.item, quantity: round(row.quantity), expected: row.expected ?? null, other: row.other ?? null });
  return [...purchase.map(shape("purchase_order")), ...transfers.map(shape("transfer_in")), ...returns.map(shape("sales_return"))];
}

export async function getWarehouseOutgoing(client, c, warehouseId) {
  requireStock(c);
  const warehouse = await loadWarehouse(client, c, warehouseId);
  const rows = async (sql) => (await client.query(sql, [c.organizationId, warehouse.id])).rows;
  const reservations = await rows(
    `SELECT reservation.id, reservation.reference_type AS reference, item.code AS sku, item.name AS item, reservation.active_quantity AS quantity FROM tenant.stock_reservations reservation
       JOIN tenant.items item ON item.organization_id = reservation.organization_id AND item.id = reservation.item_id
      WHERE reservation.organization_id = $1 AND reservation.warehouse_id = $2 AND reservation.status = 'active' AND reservation.active_quantity > 0 LIMIT 500`);
  const deliveries = await rows(
    `SELECT delivery.id, delivery.request_number AS reference, item.code AS sku, item.name AS item, line.base_quantity AS quantity FROM tenant.sales_fulfillment_requests delivery
       JOIN tenant.sales_delivery_lines line ON line.organization_id = delivery.organization_id AND line.delivery_id = delivery.id
       JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
      WHERE delivery.organization_id = $1 AND delivery.warehouse_id = $2 AND delivery.delivery_status IN ('draft', 'ready') LIMIT 500`);
  const purchaseReturns = await rows(
    `SELECT purchase_return.id, purchase_return.return_number AS reference, item.code AS sku, item.name AS item, line.base_quantity AS quantity FROM tenant.purchase_returns purchase_return
       JOIN tenant.purchase_return_lines line ON line.organization_id = purchase_return.organization_id AND line.purchase_return_id = purchase_return.id
       JOIN tenant.goods_receipt_lines receipt ON receipt.organization_id = line.organization_id AND receipt.id = line.goods_receipt_line_id
       JOIN tenant.items item ON item.organization_id = receipt.organization_id AND item.id = receipt.product_id
      WHERE purchase_return.organization_id = $1 AND COALESCE(purchase_return.warehouse_id, receipt.warehouse_id) = $2 AND purchase_return.document_status = 'draft' LIMIT 500`);
  const shape = (kind) => (row) => ({ kind, id: row.id, reference: row.reference, sku: row.sku, item: row.item, quantity: round(row.quantity), other: row.other ?? null });
  return [...reservations.map(shape("reservation")), ...deliveries.map(shape("delivery")), ...purchaseReturns.map(shape("purchase_return"))];
}

async function flowTotals(client, c, warehouseId) {
  const sum = (list) => round(list.reduce((total, entry) => total + entry.quantity, 0));
  const incoming = await getWarehouseIncoming(client, c, warehouseId);
  const outgoing = await getWarehouseOutgoing(client, c, warehouseId);
  return { incoming: sum(incoming), outgoing: sum(outgoing) };
}

export async function getWarehouseTransfers(client, c, warehouseId) {
  requireStock(c);
  const warehouse = await loadWarehouse(client, c, warehouseId);
  const { rows } = await client.query(
    `SELECT transfer.id, transfer.document_number AS transfer_number, transfer.status, line.base_quantity AS quantity, transfer.created_at, transfer.completed_at, item.code AS sku, item.name AS item,
            source.code AS source, destination.code AS destination, transfer.source_warehouse_id = $2 AS outbound
       FROM tenant.inventory_transfers transfer
       JOIN tenant.inventory_transfer_lines line ON line.organization_id = transfer.organization_id AND line.transfer_id = transfer.id
       JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
       JOIN tenant.warehouses source ON source.organization_id = transfer.organization_id AND source.id = transfer.source_warehouse_id
       JOIN tenant.warehouses destination ON destination.organization_id = transfer.organization_id AND destination.id = transfer.destination_warehouse_id
      WHERE transfer.organization_id = $1 AND (transfer.source_warehouse_id = $2 OR transfer.destination_warehouse_id = $2) ORDER BY transfer.created_at DESC LIMIT 500`, [c.organizationId, warehouse.id]);
  return rows.map((row) => ({
    id: row.id, number: row.transfer_number, status: row.status, direction: row.outbound ? "outbound" : "inbound", quantity: round(row.quantity), sku: row.sku, item: row.item,
    source: row.source, destination: row.destination, createdAt: row.created_at, completedAt: row.completed_at,
  }));
}

export async function getWarehouseBatches(client, c, warehouseId) {
  requireStock(c);
  const warehouse = await loadWarehouse(client, c, warehouseId);
  const { rows } = await client.query(
    `SELECT batch.id, batch.batch_number, batch.expires_on, batch.status, item.code AS sku, item.name AS item, COALESCE(location.code, 'MAIN') AS location, sum(balance.quantity) AS quantity,
            CASE WHEN location.location_type = 'quality' OR location.purpose = 'quality_hold' THEN 'quality_hold' ELSE 'available' END AS disposition
       FROM tenant.stock_balances balance
       JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
       JOIN tenant.items item ON item.organization_id = balance.organization_id AND item.id = balance.item_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
      WHERE balance.organization_id = $1 AND balance.warehouse_id = $2 AND balance.quantity <> 0
      GROUP BY batch.id, batch.batch_number, batch.expires_on, batch.status, item.code, item.name, location.code, location.location_type, location.purpose ORDER BY batch.expires_on NULLS LAST LIMIT 1000`,
    [c.organizationId, warehouse.id]);
  return rows.map((row) => ({ batchId: row.id, batch: row.batch_number, expiry: row.expires_on, status: row.status, sku: row.sku, item: row.item, location: row.location, quantity: round(row.quantity), disposition: row.disposition }));
}

export async function getWarehouseSerials(client, c, warehouseId) {
  requireStock(c);
  const warehouse = await loadWarehouse(client, c, warehouseId);
  const { rows } = await client.query(
    `SELECT serial.id, serial.serial_number, serial.status, item.code AS sku, item.name AS item, COALESCE(location.code, 'MAIN') AS location
       FROM tenant.stock_serials serial
       JOIN tenant.items item ON item.organization_id = serial.organization_id AND item.id = serial.item_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = serial.organization_id AND location.id = serial.warehouse_location_id
      WHERE serial.organization_id = $1 AND serial.warehouse_id = $2 ORDER BY item.code, serial.serial_number LIMIT 2000`, [c.organizationId, warehouse.id]);
  return rows.map((row) => ({ serialId: row.id, serial: row.serial_number, status: row.status, sku: row.sku, item: row.item, location: row.location }));
}

export async function getWarehouseHistory(client, c, warehouseId) {
  require(c, W.view, "You do not have permission to view warehouses.");
  const { rows } = await client.query(
    `SELECT history.*, actor.full_name AS actor_name FROM tenant.warehouse_history history LEFT JOIN public.users actor ON actor.id = history.actor_user_id
      WHERE history.organization_id = $1 AND history.warehouse_id = $2 ORDER BY history.created_at DESC, history.id DESC LIMIT 300`, [c.organizationId, uuid(warehouseId, "Warehouse")]);
  return rows.map((row) => ({ id: row.id, eventType: row.event_type, summary: row.summary, changes: row.changes, reason: row.reason, actorName: row.actor_name, createdAt: row.created_at }));
}

// What the screens need to draw warehouse forms.
export async function getWarehouseOptions(client, c) {
  require(c, W.view, "You do not have permission to view warehouses.");
  const members = (await client.query(
    `SELECT users.id, users.full_name FROM public.organization_memberships membership JOIN public.users users ON users.id = membership.user_id
      WHERE membership.organization_id = $1 AND membership.status = 'active' ORDER BY users.full_name LIMIT 1000`, [c.organizationId])).rows;
  const registrations = (await client.query(`SELECT id, code, name, state_code FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active' ORDER BY is_default DESC, code`,
    [c.organizationId])).rows;
  const organization = (await client.query(`SELECT timezone, country_code FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0] ?? {};
  return {
    types: WAREHOUSE_TYPES, purposes: LOCATION_PURPOSES, structures: LOCATION_STRUCTURES, dispositions: LOCATION_DISPOSITIONS, operations: WAREHOUSE_OPERATIONS.map((code) => ({ code, label: WAREHOUSE_OPERATION_LABELS[code] })),
    members: members.map((row) => ({ id: row.id, name: row.full_name })), registrations: registrations.map((row) => ({ id: row.id, label: `${row.code} · ${row.name}`, stateCode: row.state_code })),
    defaults: { timezone: organization.timezone ?? "Asia/Kolkata", countryCode: organization.country_code ?? "IN" },
    myDefault: await resolveDefaultWarehouse(client, c), capabilities: warehouseCapabilities(c),
  };
}
