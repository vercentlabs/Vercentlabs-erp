// The Payment Terms master (Settings → Finance & Commercial → Payment Terms): listing, creating, editing and versioning, activating,
// deactivating, and the company defaults for Sales and for Purchases.
//
// A term is identified by its id; its code is the stable short name (NET30), its name what people read. A term may be scoped to one
// buying company (a company GSTIN registration) or shared. While nothing uses a term its rules can be edited in place; once suppliers,
// customers or documents use it, changing its rules makes a new version (with a reason) — documents keep the snapshot they were agreed
// with, so nothing already agreed or posted moves. A term is never deleted, only deactivated: an inactive term cannot be chosen on new
// documents and still shows on the documents that have it.
import {
  CALCULATION, CALCULATION_TYPES, PaymentTermRuleError, REFERENCE_BASES, RULE_KINDS, TERM_TYPES, calculationLabel, describeRules, generatePaymentSchedule, snapshotOfTerm, termTypeLabel,
  validatePaymentTermRules,
} from "./terms.js";

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
const can = (context, permission) => Boolean(context.roleSlugs?.some((slug) => slug === "organization_owner" || slug === "system_administrator") || context.permissions?.includes(permission));
function requirePermission(context, permission, message) {
  if (!can(context, permission)) throw new PaymentTermError(403, message, "PERMISSION_DENIED");
}
const requireId = (value) => {
  if (!UUID.test(String(value ?? ""))) throw new PaymentTermError(404, "Payment term not found.", "PAYMENT_TERM_NOT_FOUND");
  return String(value);
};
const invalid = (field, message, code = "PAYMENT_TERM_VALIDATION") => new PaymentTermError(400, message, code, { field });
const has = (input, key) => Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;

async function recordEvent(client, context, termId, eventType, metadata = {}) {
  await client.query(`INSERT INTO tenant.payment_term_events (organization_id, payment_term_id, event_type, metadata, actor_user_id) VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [context.organizationId, termId, eventType, JSON.stringify(metadata), context.userId ?? null]);
}

// How many suppliers, customers and documents carry the term: what makes its rules versioned rather than edited.
const USAGE_SQL = `
  (SELECT count(*) FROM tenant.business_parties party WHERE party.organization_id = term.organization_id AND party.payment_term_id = term.id)::int AS customers,
  (SELECT count(*) FROM tenant.procurement_suppliers supplier WHERE supplier.organization_id = term.organization_id AND supplier.payment_term_id = term.id)::int AS suppliers,
  ((SELECT count(*) FROM tenant.sales_quotation_versions version WHERE version.organization_id = term.organization_id AND version.payment_term_id = term.id)
   + (SELECT count(*) FROM tenant.sales_order_versions version WHERE version.organization_id = term.organization_id AND version.payment_term_id = term.id)
   + (SELECT count(*) FROM tenant.purchase_orders po WHERE po.organization_id = term.organization_id AND po.payment_term_id = term.id)
   + (SELECT count(*) FROM tenant.accounting_customer_invoices invoice WHERE invoice.organization_id = term.organization_id AND invoice.payment_term_snapshot->>'id' = term.id::text)
   + (SELECT count(*) FROM tenant.accounting_vendor_bills bill WHERE bill.organization_id = term.organization_id AND bill.payment_term_snapshot->>'id' = term.id::text))::int AS documents`;

const SELECT = `
  SELECT term.*, (sales.default_payment_term_id = term.id) AS is_default_sales, (purchases.default_payment_term_id = term.id) AS is_default_purchase,
         registration.name AS registration_name, registration.registration_number AS registration_gstin, creator.full_name AS created_by_name, updater.full_name AS updated_by_name,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('sequence', line.sequence, 'percentage', line.percentage, 'basis', line.reference_basis, 'kind', line.rule_kind, 'days', line.due_days,
           'monthsOffset', line.months_offset, 'dayOfMonth', line.day_of_month) ORDER BY line.sequence) FROM tenant.payment_term_lines line
           WHERE line.organization_id = term.organization_id AND line.payment_term_id = term.id), '[]'::jsonb) AS rules,
         ${USAGE_SQL}
    FROM tenant.payment_terms term
    LEFT JOIN tenant.sales_settings sales ON sales.organization_id = term.organization_id
    LEFT JOIN tenant.procurement_settings purchases ON purchases.organization_id = term.organization_id
    LEFT JOIN tenant.tax_registrations registration ON registration.organization_id = term.organization_id AND registration.id = term.buying_registration_id
    LEFT JOIN public.users creator ON creator.id = term.created_by
    LEFT JOIN public.users updater ON updater.id = term.updated_by
   WHERE term.organization_id = $1`;

const rulesOf = (row) => (row.term_type === "custom" ? [] : (row.rules ?? []).map((rule) => ({ ...rule, percentage: String(Number(rule.percentage)) })));
const shape = (row) => {
  const rules = rulesOf(row);
  const usage = (row.customers ?? 0) + (row.suppliers ?? 0) + (row.documents ?? 0);
  return {
    id: row.id, code: row.code, name: row.name, description: row.description ?? null, termType: row.term_type, termTypeLabel: termTypeLabel(row.term_type),
    calculationType: row.calculation_type, calculationLabel: calculationLabel(row.calculation_type),
    days: row.calculation_type === CALCULATION.netDays ? Number(row.default_due_days) : row.calculation_type === CALCULATION.dueOnReceipt ? 0 : null,
    rules, summary: describeRules(rules), advancePercentage: row.advance_percentage === null ? null : String(Number(row.advance_percentage)), version: Number(row.version),
    buyingRegistrationId: row.buying_registration_id, company: row.buying_registration_id ? `${row.registration_name ?? ""}${row.registration_gstin ? ` · ${row.registration_gstin}` : ""}` : "All companies",
    salesEnabled: row.is_sales_enabled, purchaseEnabled: row.is_purchase_enabled, isDefaultSales: Boolean(row.is_default_sales), isDefaultPurchase: Boolean(row.is_default_purchase),
    status: row.status, customers: row.customers ?? 0, suppliers: row.suppliers ?? 0, documents: row.documents ?? 0, inUse: usage > 0,
    createdAt: row.created_at, createdByName: row.created_by_name ?? null, updatedAt: row.updated_at, updatedByName: row.updated_by_name ?? null,
  };
};

const OPTIONS = { termTypes: TERM_TYPES, referenceBases: REFERENCE_BASES, ruleKinds: RULE_KINDS, calculationTypes: CALCULATION_TYPES };

// getPaymentTerms. filters: status ('active' | 'inactive' | 'all'), search, usage ('sales' | 'purchase'), termType, buyingRegistrationId
export async function listPaymentTerms(client, context, filters = {}) {
  requirePermission(context, PAYMENT_TERM_PERMISSIONS.view, "You do not have permission to view payment terms.");
  const values = [context.organizationId];
  let where = "";
  if (["active", "inactive"].includes(filters.status)) { values.push(filters.status); where += ` AND term.status = $${values.length}`; }
  if (filters.usage === "sales") where += ` AND term.is_sales_enabled`;
  if (filters.usage === "purchase") where += ` AND term.is_purchase_enabled`;
  if (filters.termType) { values.push(String(filters.termType)); where += ` AND term.term_type = $${values.length}`; }
  if (filters.buyingRegistrationId && UUID.test(filters.buyingRegistrationId)) { values.push(filters.buyingRegistrationId); where += ` AND (term.buying_registration_id IS NULL OR term.buying_registration_id = $${values.length})`; }
  const search = text(filters.search, 200);
  if (search) {
    values.push(`%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
    where += ` AND (term.code ILIKE $${values.length} OR term.name ILIKE $${values.length} OR term.description ILIKE $${values.length})`;
  }
  const rows = (await client.query(`${SELECT}${where} ORDER BY (term.status = 'active') DESC, (term.term_type = 'custom'), term.default_due_days, term.name`, values)).rows;
  const registrations = (await client.query(`SELECT id, name, registration_number FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active' ORDER BY is_default DESC, name`,
    [context.organizationId])).rows.map((row) => ({ id: row.id, name: `${row.name}${row.registration_number ? ` · ${row.registration_number}` : ""}` }));
  return {
    rows: rows.map(shape), ...OPTIONS, registrations,
    capabilities: { manage: can(context, PAYMENT_TERM_PERMISSIONS.manage), setDefault: can(context, PAYMENT_TERM_PERMISSIONS.setDefault) },
  };
}
export const getPaymentTerms = listPaymentTerms;

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
  const versions = (await client.query(
    `SELECT version.version, version.snapshot, version.reason, version.created_at, actor.full_name AS created_by_name FROM tenant.payment_term_versions version
       LEFT JOIN public.users actor ON actor.id = version.created_by WHERE version.organization_id = $1 AND version.payment_term_id = $2 ORDER BY version.version DESC`,
    [context.organizationId, row.id])).rows;
  return {
    term: shape(row), events, ...OPTIONS,
    versions: versions.map((entry) => ({ version: entry.version, summary: describeRules(entry.snapshot.rules ?? []), termType: entry.snapshot.termType, reason: entry.reason, createdAt: entry.created_at,
      createdByName: entry.created_by_name })),
  };
}

// ---------------------------------------------------------------- rules from input

const SINGLE = { immediate: "days", net_days: "days", invoice_receipt: "days", end_of_month: "end_of_month", fixed_day: "fixed_day" };

// The type, rules and advance of a term from its input. Accepts the earlier shape ({ calculationType, days }) too.
function readDefinition(input, current = null) {
  let termType = input.termType ?? (input.calculationType ? { due_on_receipt: "immediate", net_days: "net_days", custom: "custom" }[input.calculationType] : null) ?? current?.term_type ?? "net_days";
  if (!TERM_TYPES.some((entry) => entry.code === termType)) throw invalid("termType", "Choose the kind of payment term.");
  let rules = input.rules;
  if (!rules && (input.calculationType || has(input, "days"))) rules = [{ percentage: "100", days: termType === "immediate" ? 0 : input.days }];
  if (!rules && current) rules = rulesOf(current);
  if (termType === "custom") rules = [];
  else {
    if (termType === "immediate") rules = [{ percentage: "100", basis: rules?.[0]?.basis ?? "invoice_date", kind: "days", days: 0 }];
    if (termType === "net_days" && rules?.length === 1) {
      const days = Number(rules[0].days);
      if (rules[0].days === undefined || rules[0].days === null || rules[0].days === "" || !Number.isInteger(days) || days < 0)
        throw invalid("days", "Enter the number of days: a whole number, zero or more.", "PAYMENT_TERM_DAYS_INVALID");
    }
    try { rules = validatePaymentTermRules(rules ?? []); } catch (error) {
      if (error instanceof PaymentTermRuleError) throw new PaymentTermError(400, error.message, error.code, error.details);
      throw error;
    }
    if (SINGLE[termType]) {
      if (rules.length !== 1) throw invalid("rules", `${termTypeLabel(termType)} has one rule for the whole amount; use Instalments for several.`, "PAYMENT_TERM_RULES_INVALID");
      if (rules[0].kind !== SINGLE[termType]) throw invalid("rules", `${termTypeLabel(termType)}: the rule must be "${RULE_KINDS.find((kind) => kind.code === SINGLE[termType]).label}".`, "PAYMENT_TERM_RULES_INVALID");
      if (termType === "invoice_receipt" && rules[0].basis !== "invoice_received") rules[0].basis = "invoice_received";
    }
    if (termType === "installments" && rules.length < 2) throw invalid("rules", "Instalments need at least two rules.", "PAYMENT_TERM_RULES_INVALID");
  }
  let advancePercentage = null;
  if (termType === "advance") {
    const raw = input.advancePercentage ?? current?.advance_percentage;
    const value = Number(raw);
    if (raw === undefined || raw === null || raw === "" || !(value > 0 && value < 100)) throw invalid("advancePercentage", "Enter the advance: a percentage above 0 and below 100.", "PAYMENT_TERM_ADVANCE_INVALID");
    advancePercentage = String(value);
  }
  // What Sales reads: due on receipt, net days (the first rule's days) or custom.
  const simple = rules.length === 1 && rules[0].kind === "days" && rules[0].basis === "invoice_date";
  const calculationType = termType === "custom" ? CALCULATION.custom : simple && rules[0].days === 0 ? CALCULATION.dueOnReceipt : CALCULATION.netDays;
  return { termType, rules, advancePercentage, calculationType, days: calculationType === CALCULATION.netDays ? rules[0]?.days ?? 0 : 0 };
}

async function assertUnique(client, context, { code, name, exceptId = null }) {
  const clash = (await client.query(
    `SELECT code, name FROM tenant.payment_terms WHERE organization_id = $1 AND ($4::uuid IS NULL OR id <> $4) AND (lower(code) = lower($2) OR lower(btrim(name)) = lower($3)) LIMIT 1`,
    [context.organizationId, code, name, exceptId])).rows[0];
  if (!clash) return;
  if (clash.code.toLowerCase() === code.toLowerCase()) throw new PaymentTermError(409, `Code ${clash.code} is already used by "${clash.name}".`, "PAYMENT_TERM_DUPLICATE_CODE", { field: "code" });
  throw new PaymentTermError(409, `There is already a payment term named "${clash.name}".`, "PAYMENT_TERM_DUPLICATE_NAME", { field: "name" });
}

async function readRegistration(client, context, value) {
  if (value === undefined || value === null || value === "") return null;
  if (!UUID.test(String(value))) throw invalid("buyingRegistrationId", "Choose the company.");
  const row = (await client.query(`SELECT id FROM tenant.tax_registrations WHERE organization_id = $1 AND id = $2`, [context.organizationId, value])).rows[0];
  if (!row) throw invalid("buyingRegistrationId", "The company registration was not found.");
  return row.id;
}

// The rules Finance splits documents with (tenant.payment_term_lines).
async function writeRules(client, context, termId, rules) {
  await client.query(`DELETE FROM tenant.payment_term_lines WHERE organization_id = $1 AND payment_term_id = $2`, [context.organizationId, termId]);
  for (const rule of rules)
    await client.query(
      `INSERT INTO tenant.payment_term_lines (organization_id, payment_term_id, sequence, due_days, percentage, reference_basis, rule_kind, months_offset, day_of_month, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
      [context.organizationId, termId, rule.sequence, rule.days, rule.percentage, rule.basis, rule.kind, rule.monthsOffset, rule.dayOfMonth, context.userId ?? null]);
}
async function writeVersion(client, context, row, reason = null) {
  const term = await loadTerm(client, context, row.id);
  await client.query(`INSERT INTO tenant.payment_term_versions (organization_id, payment_term_id, version, snapshot, reason, created_by) VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (organization_id, payment_term_id, version) DO UPDATE SET snapshot = EXCLUDED.snapshot`,
    [context.organizationId, term.id, Number(term.version), JSON.stringify(snapshotOfTerm(term, rulesOf(term))), reason, context.userId ?? null]);
}

// createPaymentTerm. input: { code, name, description?, termType, rules: [{ percentage, basis, kind, days, monthsOffset, dayOfMonth }],
//   advancePercentage? (advance), buyingRegistrationId? (company scope), salesEnabled?, purchaseEnabled? } — or the earlier { calculationType, days }.
export async function createPaymentTerm(client, context, input = {}) {
  requirePermission(context, PAYMENT_TERM_PERMISSIONS.manage, "You do not have permission to manage payment terms.");
  const code = (text(input.code, 30) ?? "").toUpperCase().replace(/\s+/g, "-");
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,29}$/.test(code)) throw invalid("code", "Enter a short code: letters, digits, dash, dot or slash (for example NET30).");
  const name = text(input.name, 120);
  if (!name) throw invalid("name", "Enter the name of the payment term.");
  const definition = readDefinition(input);
  const registration = await readRegistration(client, context, input.buyingRegistrationId);
  await assertUnique(client, context, { code, name });
  const row = (await client.query(
    `INSERT INTO tenant.payment_terms (organization_id, code, name, description, default_due_days, calculation_type, term_type, advance_percentage, buying_registration_id,
       is_sales_enabled, is_purchase_enabled, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING id`,
    [context.organizationId, code, name, text(input.description, 1000), definition.days, definition.calculationType, definition.termType, definition.advancePercentage, registration,
      input.salesEnabled !== false, input.purchaseEnabled !== false, context.userId ?? null])).rows[0];
  await writeRules(client, context, row.id, definition.rules);
  await writeVersion(client, context, row);
  await recordEvent(client, context, row.id, "payment_term.created", { code, name, type: termTypeLabel(definition.termType), rules: describeRules(definition.rules) });
  return shape(await loadTerm(client, context, row.id));
}

// updatePaymentTerm. input: { name?, description?, termType?, rules?, advancePercentage?, buyingRegistrationId?, salesEnabled?, purchaseEnabled?, newVersion?, versionReason? }.
// The code never changes. While unused, the rules are edited in place; once used, changing them needs newVersion with a reason.
export async function updatePaymentTerm(client, context, termId, input = {}) {
  requirePermission(context, PAYMENT_TERM_PERMISSIONS.manage, "You do not have permission to manage payment terms.");
  const current = await loadTerm(client, context, termId, { lock: true });
  if (has(input, "code") && String(input.code).trim().toUpperCase() !== current.code)
    throw new PaymentTermError(409, "A payment term's code does not change. Create a new term instead.", "PAYMENT_TERM_CODE_LOCKED", { field: "code" });
  const changes = [];
  const sets = [];
  const values = [context.organizationId, current.id];
  const set = (column, value) => { values.push(value); sets.push(`${column} = $${values.length}`); };
  const name = has(input, "name") ? text(input.name, 120) : current.name;
  if (!name) throw invalid("name", "Enter the name of the payment term.");
  if (name !== current.name) { await assertUnique(client, context, { code: current.code, name, exceptId: current.id }); set("name", name); changes.push({ what: "Name", from: current.name, to: name }); }
  if (has(input, "description")) {
    const description = text(input.description, 1000);
    if ((description ?? "") !== (current.description ?? "")) { set("description", description); changes.push({ what: "Description", from: current.description ?? null, to: description }); }
  }
  const definition = readDefinition(input, current);
  const before = { type: current.term_type, rules: describeRules(rulesOf(current)), advance: current.advance_percentage === null ? null : String(Number(current.advance_percentage)) };
  const after = { type: definition.termType, rules: describeRules(definition.rules), advance: definition.advancePercentage };
  const meaningChanged = JSON.stringify(before) !== JSON.stringify(after);
  let versioned = false;
  if (meaningChanged) {
    const usage = current.customers + current.suppliers + current.documents;
    if (usage > 0) {
      if (input.newVersion !== true)
        throw new PaymentTermError(409, `${current.name} is used by ${current.suppliers} supplier(s), ${current.customers} customer(s) and ${current.documents} document(s). Save the change as a new version (with a reason): documents already agreed keep the version they have.`,
          "PAYMENT_TERM_IN_USE", { field: "rules" });
      const reason = text(input.versionReason, 500);
      if (!reason || reason.length < 5) throw invalid("versionReason", "Give the reason for the new version.", "PAYMENT_TERM_VERSION_REASON_REQUIRED");
      set("version", Number(current.version) + 1);
      versioned = reason;
    }
    set("term_type", definition.termType); set("calculation_type", definition.calculationType); set("default_due_days", definition.days); set("advance_percentage", definition.advancePercentage);
    changes.push({ what: "Payment rules", from: `${termTypeLabel(before.type)}: ${before.rules}`, to: `${termTypeLabel(after.type)}: ${after.rules}` });
  }
  if (has(input, "buyingRegistrationId")) {
    const registration = await readRegistration(client, context, input.buyingRegistrationId);
    if ((registration ?? null) !== (current.buying_registration_id ?? null)) { set("buying_registration_id", registration); changes.push({ what: "Company", from: current.buying_registration_id ?? "All companies", to: registration ?? "All companies" }); }
  }
  for (const [key, column, label] of [["salesEnabled", "is_sales_enabled", "Available for Sales"], ["purchaseEnabled", "is_purchase_enabled", "Available for Purchases"]]) {
    if (!has(input, key) || Boolean(input[key]) === current[column]) continue;
    if (key === "salesEnabled" && !input[key] && current.is_default_sales)
      throw new PaymentTermError(409, "This is the default payment term for Sales. Choose another default first.", "PAYMENT_TERM_IS_DEFAULT");
    if (key === "purchaseEnabled" && !input[key] && current.is_default_purchase)
      throw new PaymentTermError(409, "This is the default payment term for Purchases. Choose another default first.", "PAYMENT_TERM_IS_DEFAULT");
    set(column, Boolean(input[key]));
    changes.push({ what: label, from: current[column] ? "Yes" : "No", to: input[key] ? "Yes" : "No" });
  }
  if (!changes.length) return shape(current);
  values.push(context.userId ?? null);
  await client.query(`UPDATE tenant.payment_terms SET ${sets.join(", ")}, updated_by = $${values.length}, updated_at = now() WHERE organization_id = $1 AND id = $2`, values);
  if (meaningChanged) {
    await writeRules(client, context, current.id, definition.rules);
    await writeVersion(client, context, current, versioned || null);
  }
  await recordEvent(client, context, current.id, versioned ? "payment_term.versioned" : "payment_term.updated", { changes, ...(versioned ? { version: Number(current.version) + 1, reason: versioned } : {}) });
  return shape(await loadTerm(client, context, current.id));
}
// versionPaymentTerm: a used term's rules changed as a new version. input: as updatePaymentTerm, with versionReason.
export const versionPaymentTerm = (client, context, termId, input = {}) => updatePaymentTerm(client, context, termId, { ...input, newVersion: true });

async function setStatus(client, context, termId, status) {
  requirePermission(context, PAYMENT_TERM_PERMISSIONS.manage, "You do not have permission to manage payment terms.");
  const current = await loadTerm(client, context, termId, { lock: true });
  if (current.status === status) return shape(current);
  if (status === "inactive" && (current.is_default_sales || current.is_default_purchase))
    throw new PaymentTermError(409, `This is the default payment term for ${current.is_default_sales ? "Sales" : "Purchases"}. Choose another default before deactivating it.`, "PAYMENT_TERM_IS_DEFAULT");
  await client.query(`UPDATE tenant.payment_terms SET status = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, current.id, status, context.userId ?? null]);
  await recordEvent(client, context, current.id, status === "active" ? "payment_term.activated" : "payment_term.deactivated",
    { customers: current.customers, suppliers: current.suppliers, documents: current.documents });
  return shape(await loadTerm(client, context, current.id));
}
// Active again: it can be chosen on new documents.
export const activatePaymentTerm = (client, context, termId) => setStatus(client, context, termId, "active");
// No longer offered on new documents; it stays on the suppliers, customers and documents that have it.
export const deactivatePaymentTerm = (client, context, termId) => setStatus(client, context, termId, "inactive");

// The company default for Sales (customers without terms) or Purchases (suppliers without terms). termId null: no company default.
async function setDefault(client, context, termId, direction) {
  requirePermission(context, PAYMENT_TERM_PERMISSIONS.setDefault, "You do not have permission to set the default payment term.");
  const next = termId ? await loadTerm(client, context, termId, { lock: true }) : null;
  const sales = direction === "sales";
  if (next && next.status !== "active") throw new PaymentTermError(409, `${next.name} is inactive. Activate it before making it the default.`, "PAYMENT_TERM_INACTIVE");
  if (next && sales && !next.is_sales_enabled) throw new PaymentTermError(409, `${next.name} is not available for Sales.`, "PAYMENT_TERM_NOT_FOR_SALES");
  if (next && !sales && !next.is_purchase_enabled) throw new PaymentTermError(409, `${next.name} is not available for Purchases.`, "PAYMENT_TERM_NOT_FOR_PURCHASES");
  if (next && next.buying_registration_id) throw new PaymentTermError(409, `${next.name} is scoped to one company: the company default must be a shared term.`, "PAYMENT_TERM_SCOPED");
  const table = sales ? "sales_settings" : "procurement_settings";
  const previous = (await client.query(
    `SELECT term.id, term.name FROM tenant.${table} settings JOIN tenant.payment_terms term ON term.id = settings.default_payment_term_id WHERE settings.organization_id = $1`,
    [context.organizationId])).rows[0] ?? null;
  if ((previous?.id ?? null) === (next?.id ?? null)) return { defaultPaymentTermId: next?.id ?? null, changed: false };
  await client.query(
    `INSERT INTO tenant.${table} (organization_id, default_payment_term_id) VALUES ($1, $2)
     ON CONFLICT (organization_id) DO UPDATE SET default_payment_term_id = EXCLUDED.default_payment_term_id`, [context.organizationId, next?.id ?? null]);
  const label = sales ? "Sales" : "Purchases";
  if (previous) await recordEvent(client, context, previous.id, "payment_term.default_removed", { direction: label, replacedBy: next?.name ?? null });
  if (next) await recordEvent(client, context, next.id, "payment_term.default_set", { direction: label, replaced: previous?.name ?? null });
  return { defaultPaymentTermId: next?.id ?? null, changed: true };
}
export const setDefaultSalesPaymentTerm = (client, context, termId) => setDefault(client, context, termId, "sales");
export const setDefaultPurchasePaymentTerm = (client, context, termId) => setDefault(client, context, termId, "purchase");

// previewPaymentTerm: the schedule a term (saved or being edited) gives a document of `total` dated `invoiceDate`.
// input: { termId? | termType, rules, advancePercentage? }, { total, invoiceDate, invoiceReceivedDate?, postingDate?, precision? }
export async function previewPaymentTerm(client, context, input = {}) {
  requirePermission(context, PAYMENT_TERM_PERMISSIONS.view, "You do not have permission to view payment terms.");
  const term = input.termId ? await loadTerm(client, context, input.termId) : null;
  const definition = term && !input.rules ? { termType: term.term_type, rules: rulesOf(term), advancePercentage: term.advance_percentage } : readDefinition(input);
  const snapshot = { id: term?.id ?? "preview", name: term?.name ?? "Preview", termType: definition.termType, calculationType: definition.termType === "custom" ? "custom" : "net_days", rules: definition.rules };
  const schedule = generatePaymentSchedule(snapshot, { total: String(input.total ?? "100000"), precision: Number(input.precision ?? 2),
    dates: { invoiceDate: input.invoiceDate, invoiceReceivedDate: input.invoiceReceivedDate, postingDate: input.postingDate } });
  return {
    summary: describeRules(definition.rules), advancePercentage: definition.advancePercentage ?? null,
    lines: (schedule ?? []).map((line) => ({ sequence: line.sequence, percentage: line.percentage, amount: (Number(line.amount) / 1e6).toFixed(2), dueDate: line.dueDate, referenceDate: line.referenceDate,
      basis: line.basis, missing: line.missing })),
  };
}

// ---------------------------------------------------------------- terms on documents

async function termWithRules(client, organizationId, termId) {
  return (await client.query(`${SELECT} AND term.id = $2`, [organizationId, termId])).rows[0] ?? null;
}

// A term that can be put on a new sales document: the tenant's own, active and available for Sales. Returns its snapshot.
export async function salesTermSnapshot(client, organizationId, termId, note = null) {
  if (!UUID.test(String(termId ?? ""))) throw new PaymentTermError(400, "Choose the payment terms.", "PAYMENT_TERM_INVALID", { field: "paymentTermId" });
  const term = await termWithRules(client, organizationId, termId);
  if (!term) throw new PaymentTermError(404, "The payment terms were not found.", "PAYMENT_TERM_NOT_FOUND", { field: "paymentTermId" });
  if (term.status !== "active") throw new PaymentTermError(409, `${term.name} is inactive and cannot be used on new documents.`, "PAYMENT_TERM_INACTIVE", { field: "paymentTermId" });
  if (!term.is_sales_enabled) throw new PaymentTermError(409, `${term.name} is not available for Sales.`, "PAYMENT_TERM_NOT_FOR_SALES", { field: "paymentTermId" });
  return snapshotOfTerm(term, rulesOf(term), note);
}

// The active terms offered on sales documents and customers.
export async function listSalesTermOptions(client, organizationId) {
  return (await client.query(
    `SELECT term.id, term.code, term.name, term.description, term.calculation_type, term.term_type, term.default_due_days, (settings.default_payment_term_id = term.id) AS is_default
       FROM tenant.payment_terms term LEFT JOIN tenant.sales_settings settings ON settings.organization_id = term.organization_id
      WHERE term.organization_id = $1 AND term.status = 'active' AND term.is_sales_enabled
      ORDER BY (term.calculation_type = 'custom'), term.default_due_days, term.name`, [organizationId])).rows
    .map((row) => ({ ...row, is_default: Boolean(row.is_default), days: row.calculation_type === CALCULATION.netDays ? Number(row.default_due_days) : row.calculation_type === CALCULATION.dueOnReceipt ? 0 : null }));
}

// A term that can be a supplier's default or go on a new purchase document: the tenant's own, active, available for Purchases and, when
// scoped to a company, that document's company. Returns its snapshot (with its rules and version).
export async function purchaseTermSnapshot(client, organizationId, termId, note = null, { buyingRegistrationId = null } = {}) {
  if (!UUID.test(String(termId ?? ""))) throw new PaymentTermError(400, "Choose the payment terms.", "PAYMENT_TERM_INVALID", { field: "paymentTermId" });
  const term = await termWithRules(client, organizationId, termId);
  if (!term) throw new PaymentTermError(404, "The payment terms were not found.", "PAYMENT_TERM_NOT_FOUND", { field: "paymentTermId" });
  if (term.status !== "active") throw new PaymentTermError(409, `${term.name} is inactive and cannot be used on new documents.`, "PAYMENT_TERM_INACTIVE", { field: "paymentTermId" });
  if (!term.is_purchase_enabled) throw new PaymentTermError(409, `${term.name} is not available for Purchases.`, "PAYMENT_TERM_NOT_FOR_PURCHASES", { field: "paymentTermId" });
  if (term.buying_registration_id && buyingRegistrationId && term.buying_registration_id !== buyingRegistrationId)
    throw new PaymentTermError(409, `${term.name} is agreed for another company.`, "PAYMENT_TERM_OTHER_COMPANY", { field: "paymentTermId" });
  return snapshotOfTerm(term, rulesOf(term), note);
}

// The active terms offered on suppliers and purchase documents (of `buyingRegistrationId`'s company, when given), with the company default.
export async function listPurchaseTermOptions(client, organizationId, { buyingRegistrationId = null } = {}) {
  return (await client.query(
    `SELECT term.id, term.code, term.name, term.description, term.calculation_type, term.term_type, term.default_due_days, term.advance_percentage, term.buying_registration_id,
            (settings.default_payment_term_id = term.id) AS is_default
       FROM tenant.payment_terms term LEFT JOIN tenant.procurement_settings settings ON settings.organization_id = term.organization_id
      WHERE term.organization_id = $1 AND term.status = 'active' AND term.is_purchase_enabled AND ($2::uuid IS NULL OR term.buying_registration_id IS NULL OR term.buying_registration_id = $2)
      ORDER BY (term.calculation_type = 'custom'), term.default_due_days, term.name`, [organizationId, buyingRegistrationId])).rows
    .map((row) => ({ ...row, is_default: Boolean(row.is_default), days: row.calculation_type === CALCULATION.netDays ? Number(row.default_due_days) : row.calculation_type === CALCULATION.dueOnReceipt ? 0 : null,
      advance_percentage: row.advance_percentage === null ? null : String(Number(row.advance_percentage)) }));
}

// getSupplierDefaultPaymentTerm: the supplier's own term, else the company's default for Purchases. Returns { paymentTermId, source }.
export async function getSupplierDefaultPaymentTerm(client, organizationId, supplierId) {
  const row = (await client.query(
    `SELECT (SELECT supplier.payment_term_id FROM tenant.procurement_suppliers supplier WHERE supplier.organization_id = $1 AND supplier.id = $2) AS supplier_term,
            (SELECT settings.default_payment_term_id FROM tenant.procurement_settings settings WHERE settings.organization_id = $1) AS company_term`, [organizationId, supplierId ?? null])).rows[0];
  return { paymentTermId: row.supplier_term ?? row.company_term ?? null, source: row.supplier_term ? "supplier" : row.company_term ? "company" : null };
}
