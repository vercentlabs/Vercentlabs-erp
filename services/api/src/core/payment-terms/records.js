// The Payment Terms master: listing, creating, editing, activating,
// deactivating and choosing the default for Sales.
//
// A term is identified by its id; its code is the stable short name
// (NET30), its name what people read. A term that documents or customers
// already use keeps its meaning: the way its due date is worked out and its
// number of days can no longer change (make a new term, NET45, instead), and
// it is never deleted, only deactivated. An inactive term cannot be chosen
// on new documents and still shows on the documents that have it.
import { CALCULATION, CALCULATION_TYPES, MAX_NET_DAYS, calculationLabel, snapshotOfTerm } from "./terms.js";

export const PAYMENT_TERM_PERMISSIONS = Object.freeze({ view: "payment_terms.view", manage: "payment_terms.manage", setDefault: "payment_terms.set_default" });

export class PaymentTermError extends Error {
  constructor(status, message, code = "PAYMENT_TERM_ERROR", details = undefined) {
    super(message);
    this.name = "PaymentTermError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value, limit) => { const result = String(value ?? "").trim().slice(0, limit); return result || null; };
const can = (context, permission) => Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission));
function requirePermission(context, permission, message) {
  if (!can(context, permission)) throw new PaymentTermError(403, message, "PERMISSION_DENIED");
}
const requireId = (value) => {
  if (!UUID.test(String(value ?? ""))) throw new PaymentTermError(404, "Payment term not found.", "PAYMENT_TERM_NOT_FOUND");
  return String(value);
};
const invalid = (field, message, code = "PAYMENT_TERM_VALIDATION") => new PaymentTermError(400, message, code, { field });

async function recordEvent(client, context, termId, eventType, metadata = {}) {
  await client.query(`INSERT INTO tenant.payment_term_events (organization_id, payment_term_id, event_type, metadata, actor_user_id) VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [context.organizationId, termId, eventType, JSON.stringify(metadata), context.userId ?? null]);
}

// How many customers and documents carry the term: what makes its meaning fixed.
const USAGE_SQL = `
  (SELECT count(*) FROM tenant.business_parties party WHERE party.organization_id = term.organization_id AND party.payment_term_id = term.id)::int AS customers,
  ((SELECT count(*) FROM tenant.sales_quotation_versions version WHERE version.organization_id = term.organization_id AND version.payment_term_id = term.id)
   + (SELECT count(*) FROM tenant.sales_order_versions version WHERE version.organization_id = term.organization_id AND version.payment_term_id = term.id)
   + (SELECT count(*) FROM tenant.accounting_customer_invoices invoice WHERE invoice.organization_id = term.organization_id AND invoice.payment_term_snapshot->>'id' = term.id::text)
   + (SELECT count(*) FROM tenant.accounting_vendor_bills bill WHERE bill.organization_id = term.organization_id AND bill.payment_term_snapshot->>'id' = term.id::text))::int AS documents`;

const shape = (row) => ({
  id: row.id, code: row.code, name: row.name, description: row.description ?? null, calculationType: row.calculation_type, calculationLabel: calculationLabel(row.calculation_type),
  days: row.calculation_type === CALCULATION.netDays ? Number(row.default_due_days) : row.calculation_type === CALCULATION.dueOnReceipt ? 0 : null,
  salesEnabled: row.is_sales_enabled, purchaseEnabled: row.is_purchase_enabled, isDefaultSales: Boolean(row.is_default_sales), status: row.status,
  customers: row.customers ?? 0, documents: row.documents ?? 0, inUse: (row.customers ?? 0) + (row.documents ?? 0) > 0,
  createdAt: row.created_at, createdByName: row.created_by_name ?? null, updatedAt: row.updated_at, updatedByName: row.updated_by_name ?? null,
});

const SELECT = `
  SELECT term.*, (settings.default_payment_term_id = term.id) AS is_default_sales, creator.full_name AS created_by_name, updater.full_name AS updated_by_name, ${USAGE_SQL}
    FROM tenant.payment_terms term
    LEFT JOIN tenant.sales_settings settings ON settings.organization_id = term.organization_id
    LEFT JOIN public.users creator ON creator.id = term.created_by
    LEFT JOIN public.users updater ON updater.id = term.updated_by
   WHERE term.organization_id = $1`;

// filters: status ('active' | 'inactive' | 'all'), search, usage ('sales' | 'purchase')
export async function listPaymentTerms(client, context, filters = {}) {
  requirePermission(context, PAYMENT_TERM_PERMISSIONS.view, "You do not have permission to view payment terms.");
  const values = [context.organizationId];
  let where = "";
  if (["active", "inactive"].includes(filters.status)) { values.push(filters.status); where += ` AND term.status = $${values.length}`; }
  if (filters.usage === "sales") where += ` AND term.is_sales_enabled`;
  if (filters.usage === "purchase") where += ` AND term.is_purchase_enabled`;
  const search = text(filters.search, 200);
  if (search) {
    values.push(`%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
    where += ` AND (term.code ILIKE $${values.length} OR term.name ILIKE $${values.length} OR term.description ILIKE $${values.length})`;
  }
  const rows = (await client.query(`${SELECT}${where} ORDER BY (term.status = 'active') DESC, (term.calculation_type = 'custom'), term.default_due_days, term.name`, values)).rows;
  return {
    rows: rows.map(shape),
    calculationTypes: CALCULATION_TYPES,
    capabilities: { manage: can(context, PAYMENT_TERM_PERMISSIONS.manage), setDefault: can(context, PAYMENT_TERM_PERMISSIONS.setDefault) },
  };
}

async function loadTerm(client, context, termId, { lock = false } = {}) {
  const id = requireId(termId);
  if (lock) await client.query(`SELECT 1 FROM tenant.payment_terms WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, id]);
  const row = (await client.query(`${SELECT} AND term.id = $2`, [context.organizationId, id])).rows[0];
  if (!row) throw new PaymentTermError(404, "Payment term not found.", "PAYMENT_TERM_NOT_FOUND");
  return row;
}

export async function getPaymentTerm(client, context, termId) {
  requirePermission(context, PAYMENT_TERM_PERMISSIONS.view, "You do not have permission to view payment terms.");
  const row = await loadTerm(client, context, termId);
  const events = (await client.query(
    `SELECT event.id, event.event_type, event.metadata, event.occurred_at, actor.full_name AS actor_name FROM tenant.payment_term_events event
       LEFT JOIN public.users actor ON actor.id = event.actor_user_id WHERE event.organization_id = $1 AND event.payment_term_id = $2 ORDER BY event.occurred_at DESC`,
    [context.organizationId, row.id])).rows;
  return { term: shape(row), events };
}

function readCalculation(input, current = null) {
  const type = input.calculationType ?? current?.calculation_type ?? CALCULATION.netDays;
  if (!Object.values(CALCULATION).includes(type)) throw invalid("calculationType", "Choose how the due date is worked out.");
  if (type !== CALCULATION.netDays) return { type, days: 0 };
  const raw = input.days ?? (current?.calculation_type === CALCULATION.netDays ? current.default_due_days : null);
  const days = Number(raw);
  if (raw === null || raw === undefined || raw === "" || !Number.isInteger(days) || days < 0)
    throw invalid("days", "Enter the number of days: a whole number, zero or more.", "PAYMENT_TERM_DAYS_INVALID");
  if (days > MAX_NET_DAYS) throw invalid("days", `The number of days cannot be more than ${MAX_NET_DAYS}.`, "PAYMENT_TERM_DAYS_INVALID");
  return { type, days };
}

async function assertUnique(client, context, { code, name, exceptId = null }) {
  const clash = (await client.query(
    `SELECT code, name FROM tenant.payment_terms WHERE organization_id = $1 AND ($4::uuid IS NULL OR id <> $4) AND (lower(code) = lower($2) OR lower(btrim(name)) = lower($3)) LIMIT 1`,
    [context.organizationId, code, name, exceptId])).rows[0];
  if (!clash) return;
  if (clash.code.toLowerCase() === code.toLowerCase()) throw new PaymentTermError(409, `Code ${clash.code} is already used by "${clash.name}".`, "PAYMENT_TERM_DUPLICATE_CODE", { field: "code" });
  throw new PaymentTermError(409, `There is already a payment term named "${clash.name}".`, "PAYMENT_TERM_DUPLICATE_NAME", { field: "name" });
}

// Finance splits a document into instalments from tenant.payment_term_lines: a term is one instalment of 100%.
async function writeSchedule(client, context, termId, days) {
  await client.query(
    `INSERT INTO tenant.payment_term_lines (organization_id, payment_term_id, sequence, due_days, percentage, created_by, updated_by) VALUES ($1, $2, 1, $3, 100, $4, $4)
     ON CONFLICT (organization_id, payment_term_id, sequence) DO UPDATE SET due_days = EXCLUDED.due_days, percentage = 100, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, termId, days, context.userId ?? null]);
}

// input: { code, name, calculationType ('due_on_receipt' | 'net_days' | 'custom'), days? (net_days), description?, salesEnabled?, purchaseEnabled? }
export async function createPaymentTerm(client, context, input = {}) {
  requirePermission(context, PAYMENT_TERM_PERMISSIONS.manage, "You do not have permission to manage payment terms.");
  const code = (text(input.code, 30) ?? "").toUpperCase().replace(/\s+/g, "-");
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,29}$/.test(code)) throw invalid("code", "Enter a short code: letters, digits, dash, dot or slash (for example NET30).");
  const name = text(input.name, 120);
  if (!name) throw invalid("name", "Enter the name of the payment term.");
  const calculation = readCalculation(input);
  await assertUnique(client, context, { code, name });
  const row = (await client.query(
    `INSERT INTO tenant.payment_terms (organization_id, code, name, description, default_due_days, calculation_type, is_sales_enabled, is_purchase_enabled, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
    [context.organizationId, code, name, text(input.description, 1000), calculation.days, calculation.type, input.salesEnabled !== false, input.purchaseEnabled !== false, context.userId ?? null])).rows[0];
  await writeSchedule(client, context, row.id, calculation.days);
  await recordEvent(client, context, row.id, "payment_term.created", { code, name, calculation: calculationLabel(calculation.type), days: calculation.type === CALCULATION.netDays ? calculation.days : undefined });
  return shape(await loadTerm(client, context, row.id));
}

// input: { name?, description?, calculationType?, days?, salesEnabled?, purchaseEnabled? }. The code never changes; once the term
// is in use, neither does the way its due date is worked out.
export async function updatePaymentTerm(client, context, termId, input = {}) {
  requirePermission(context, PAYMENT_TERM_PERMISSIONS.manage, "You do not have permission to manage payment terms.");
  const current = await loadTerm(client, context, termId, { lock: true });
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;
  if (has("code") && String(input.code).trim().toUpperCase() !== current.code)
    throw new PaymentTermError(409, "A payment term's code does not change. Create a new term instead.", "PAYMENT_TERM_CODE_LOCKED", { field: "code" });
  const changes = [];
  const sets = [];
  const values = [context.organizationId, current.id];
  const set = (column, value) => { values.push(value); sets.push(`${column} = $${values.length}`); };
  const name = has("name") ? text(input.name, 120) : current.name;
  if (!name) throw invalid("name", "Enter the name of the payment term.");
  if (name !== current.name) { await assertUnique(client, context, { code: current.code, name, exceptId: current.id }); set("name", name); changes.push({ what: "Name", from: current.name, to: name }); }
  if (has("description")) {
    const description = text(input.description, 1000);
    if ((description ?? "") !== (current.description ?? "")) { set("description", description); changes.push({ what: "Description", from: current.description ?? null, to: description }); }
  }
  const calculation = readCalculation(input, current);
  const meaningChanged = calculation.type !== current.calculation_type || (calculation.type === CALCULATION.netDays && calculation.days !== Number(current.default_due_days));
  if (meaningChanged) {
    // Changing what NET30 means would misdescribe every document that says NET30.
    if (current.customers + current.documents > 0)
      throw new PaymentTermError(409, `${current.name} is used by ${current.customers} customer(s) and ${current.documents} document(s), so the way its due date is worked out cannot change. Create a new payment term and use that from now on.`,
        "PAYMENT_TERM_IN_USE", { field: "days" });
    set("calculation_type", calculation.type);
    set("default_due_days", calculation.days);
    changes.push({ what: "Due date", from: describe(current.calculation_type, current.default_due_days), to: describe(calculation.type, calculation.days) });
  }
  for (const [key, column, label] of [["salesEnabled", "is_sales_enabled", "Available for Sales"], ["purchaseEnabled", "is_purchase_enabled", "Available for Purchases"]]) {
    if (!has(key) || Boolean(input[key]) === current[column]) continue;
    if (key === "salesEnabled" && !input[key] && current.is_default_sales)
      throw new PaymentTermError(409, "This is the default payment term for Sales. Choose another default first.", "PAYMENT_TERM_IS_DEFAULT");
    set(column, Boolean(input[key]));
    changes.push({ what: label, from: current[column] ? "Yes" : "No", to: input[key] ? "Yes" : "No" });
  }
  if (!changes.length) return shape(current);
  values.push(context.userId ?? null);
  await client.query(`UPDATE tenant.payment_terms SET ${sets.join(", ")}, updated_by = $${values.length}, updated_at = now() WHERE organization_id = $1 AND id = $2`, values);
  if (meaningChanged) await writeSchedule(client, context, current.id, calculation.days);
  await recordEvent(client, context, current.id, "payment_term.updated", { changes });
  return shape(await loadTerm(client, context, current.id));
}
const describe = (type, days) => (type === CALCULATION.netDays ? `Net ${Number(days)} days` : calculationLabel(type));

async function setStatus(client, context, termId, status) {
  requirePermission(context, PAYMENT_TERM_PERMISSIONS.manage, "You do not have permission to manage payment terms.");
  const current = await loadTerm(client, context, termId, { lock: true });
  if (current.status === status) return shape(current);
  if (status === "inactive" && current.is_default_sales)
    throw new PaymentTermError(409, "This is the default payment term for Sales. Choose another default before deactivating it.", "PAYMENT_TERM_IS_DEFAULT");
  await client.query(`UPDATE tenant.payment_terms SET status = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, current.id, status, context.userId ?? null]);
  await recordEvent(client, context, current.id, status === "active" ? "payment_term.activated" : "payment_term.deactivated", { customers: current.customers, documents: current.documents });
  return shape(await loadTerm(client, context, current.id));
}
// Active again: it can be chosen on new documents.
export const activatePaymentTerm = (client, context, termId) => setStatus(client, context, termId, "active");
// No longer offered on new documents; it stays on the customers and documents that have it.
export const deactivatePaymentTerm = (client, context, termId) => setStatus(client, context, termId, "inactive");

// The one term new sales documents use when the customer has none. termId null: no company default.
export async function setDefaultSalesPaymentTerm(client, context, termId) {
  requirePermission(context, PAYMENT_TERM_PERMISSIONS.setDefault, "You do not have permission to set the default payment term.");
  const next = termId ? await loadTerm(client, context, termId, { lock: true }) : null;
  if (next && next.status !== "active") throw new PaymentTermError(409, `${next.name} is inactive. Activate it before making it the default.`, "PAYMENT_TERM_INACTIVE");
  if (next && !next.is_sales_enabled) throw new PaymentTermError(409, `${next.name} is not available for Sales.`, "PAYMENT_TERM_NOT_FOR_SALES");
  const previous = (await client.query(
    `SELECT term.id, term.name FROM tenant.sales_settings settings JOIN tenant.payment_terms term ON term.id = settings.default_payment_term_id WHERE settings.organization_id = $1`,
    [context.organizationId])).rows[0] ?? null;
  if ((previous?.id ?? null) === (next?.id ?? null)) return { defaultPaymentTermId: next?.id ?? null, changed: false };
  await client.query(
    `INSERT INTO tenant.sales_settings (organization_id, default_payment_term_id) VALUES ($1, $2)
     ON CONFLICT (organization_id) DO UPDATE SET default_payment_term_id = EXCLUDED.default_payment_term_id`, [context.organizationId, next?.id ?? null]);
  if (previous) await recordEvent(client, context, previous.id, "payment_term.default_removed", { replacedBy: next?.name ?? null });
  if (next) await recordEvent(client, context, next.id, "payment_term.default_set", { replaced: previous?.name ?? null });
  return { defaultPaymentTermId: next?.id ?? null, changed: true };
}

// A term that can be put on a new sales document: the tenant's own, active and available for Sales. Returns its snapshot.
export async function salesTermSnapshot(client, organizationId, termId, note = null) {
  if (!UUID.test(String(termId ?? ""))) throw new PaymentTermError(400, "Choose the payment terms.", "PAYMENT_TERM_INVALID", { field: "paymentTermId" });
  const term = (await client.query(`SELECT * FROM tenant.payment_terms WHERE organization_id = $1 AND id = $2`, [organizationId, termId])).rows[0];
  if (!term) throw new PaymentTermError(404, "The payment terms were not found.", "PAYMENT_TERM_NOT_FOUND", { field: "paymentTermId" });
  if (term.status !== "active") throw new PaymentTermError(409, `${term.name} is inactive and cannot be used on new documents.`, "PAYMENT_TERM_INACTIVE", { field: "paymentTermId" });
  if (!term.is_sales_enabled) throw new PaymentTermError(409, `${term.name} is not available for Sales.`, "PAYMENT_TERM_NOT_FOR_SALES", { field: "paymentTermId" });
  return snapshotOfTerm(term, note);
}

// The active terms offered on sales documents and customers.
export async function listSalesTermOptions(client, organizationId) {
  return (await client.query(
    `SELECT term.id, term.code, term.name, term.description, term.calculation_type, term.default_due_days, (settings.default_payment_term_id = term.id) AS is_default
       FROM tenant.payment_terms term LEFT JOIN tenant.sales_settings settings ON settings.organization_id = term.organization_id
      WHERE term.organization_id = $1 AND term.status = 'active' AND term.is_sales_enabled
      ORDER BY (term.calculation_type = 'custom'), term.default_due_days, term.name`, [organizationId])).rows
    .map((row) => ({ ...row, is_default: Boolean(row.is_default), days: row.calculation_type === CALCULATION.netDays ? Number(row.default_due_days) : row.calculation_type === CALCULATION.dueOnReceipt ? 0 : null }));
}

// A term that can be a supplier's default or go on a new purchase document: the tenant's own, active and available for Purchases.
export async function purchaseTermSnapshot(client, organizationId, termId, note = null) {
  if (!UUID.test(String(termId ?? ""))) throw new PaymentTermError(400, "Choose the payment terms.", "PAYMENT_TERM_INVALID", { field: "paymentTermId" });
  const term = (await client.query(`SELECT * FROM tenant.payment_terms WHERE organization_id = $1 AND id = $2`, [organizationId, termId])).rows[0];
  if (!term) throw new PaymentTermError(404, "The payment terms were not found.", "PAYMENT_TERM_NOT_FOUND", { field: "paymentTermId" });
  if (term.status !== "active") throw new PaymentTermError(409, `${term.name} is inactive and cannot be used on new documents.`, "PAYMENT_TERM_INACTIVE", { field: "paymentTermId" });
  if (!term.is_purchase_enabled) throw new PaymentTermError(409, `${term.name} is not available for Purchases.`, "PAYMENT_TERM_NOT_FOR_PURCHASES", { field: "paymentTermId" });
  return snapshotOfTerm(term, note);
}

// The active terms offered on suppliers and purchase documents.
export async function listPurchaseTermOptions(client, organizationId) {
  return (await client.query(
    `SELECT id, code, name, description, calculation_type, default_due_days FROM tenant.payment_terms
      WHERE organization_id = $1 AND status = 'active' AND is_purchase_enabled
      ORDER BY (calculation_type = 'custom'), default_due_days, name`, [organizationId])).rows
    .map((row) => ({ ...row, days: row.calculation_type === CALCULATION.netDays ? Number(row.default_due_days) : row.calculation_type === CALCULATION.dueOnReceipt ? 0 : null }));
}
