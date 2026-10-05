// Tax configuration: tax categories with their dated rates, the company's
// tax registrations, the organization's tax defaults and the audit trail of
// every change to them.
//
// A category charges one rate at a time. A rate is never edited once it
// exists: a change ends the current rate the day before and starts a new one,
// so documents dated earlier keep the rate that applied to them. Categories
// and registrations are made inactive, never deleted.
import {
  GSTIN_PATTERN, GST_STATES, SUPPLY_TYPES, TAX_APPLIES_TO, TAX_PERMISSIONS, TAX_TREATMENTS, TAX_TYPES, TaxError, can, dayOf, gstStateName, has, isUuid, requireTaxPermission,
  requireUuid, text,
} from "./constants.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const codeOf = (list) => list.map((entry) => entry.code);
const labelOf = (list, code) => list.find((entry) => entry.code === code)?.label ?? code;
const today = async (client) => (await client.query(`SELECT current_date::text AS d`)).rows[0].d;

function invalid(message, field) {
  return new TaxError(400, message, "TAX_VALIDATION", field ? { field } : undefined);
}
function percentage(value, label, { maximum = 100, required = true } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw invalid(`Enter ${label}.`, label);
    return 0;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > maximum) throw invalid(`${label[0].toUpperCase()}${label.slice(1)} must be between 0 and ${maximum}.`, label);
  return number;
}
function day(value, label) {
  const result = text(value, 10);
  if (!result || !DATE.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) throw invalid(`${label} must be a date.`, label);
  return result;
}

// ------------------------------------------------------------ audit trail

async function record(client, context, entityType, entityId, eventType, summary, changes = {}) {
  await client.query(
    `INSERT INTO tenant.tax_history (organization_id, entity_type, entity_id, event_type, summary, changes, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [context.organizationId, entityType, entityId, eventType, summary, JSON.stringify(changes), context.userId ?? null]);
}

// filters: entityType, entityId, limit
export async function listTaxHistory(client, context, filters = {}) {
  requireTaxPermission(context, TAX_PERMISSIONS.viewAudit, "You do not have permission to view the tax audit trail.");
  const values = [context.organizationId];
  let where = "";
  if (filters.entityType) { values.push(String(filters.entityType)); where += ` AND history.entity_type = $${values.length}`; }
  if (isUuid(filters.entityId)) { values.push(filters.entityId); where += ` AND history.entity_id = $${values.length}`; }
  values.push(Math.min(500, Math.max(1, Number.parseInt(filters.limit, 10) || 200)));
  const { rows } = await client.query(
    `SELECT history.id, history.entity_type, history.entity_id, history.event_type, history.summary, history.changes, history.created_at, actor.full_name AS actor_name
       FROM tenant.tax_history history LEFT JOIN public.users actor ON actor.id = history.actor_user_id
      WHERE history.organization_id = $1${where} ORDER BY history.created_at DESC, history.id DESC LIMIT $${values.length}`, values);
  return rows.map((row) => ({
    id: row.id, entityType: row.entity_type, entityId: row.entity_id, eventType: row.event_type, summary: row.summary, changes: row.changes, at: row.created_at,
    actorName: row.actor_name ?? null,
  }));
}

// ------------------------------------------------------------ tax categories

const CATEGORY_SQL = `
  SELECT category.*,
         current_rate.id AS rate_id, current_rate.rate, current_rate.cess_rate, current_rate.effective_from, current_rate.effective_to,
         next_rate.rate AS next_rate, next_rate.cess_rate AS next_cess_rate, next_rate.effective_from AS next_effective_from,
         (SELECT count(*) FROM tenant.items item WHERE item.organization_id = category.organization_id AND item.tax_category_id = category.id)::int AS product_count
    FROM tenant.tax_categories category
    LEFT JOIN LATERAL (
      SELECT * FROM tenant.tax_rates rate WHERE rate.organization_id = category.organization_id AND rate.tax_category_id = category.id AND rate.status = 'active'
         AND rate.effective_from <= $2::date AND (rate.effective_to IS NULL OR rate.effective_to >= $2::date) ORDER BY rate.effective_from DESC LIMIT 1) current_rate ON true
    LEFT JOIN LATERAL (
      SELECT * FROM tenant.tax_rates rate WHERE rate.organization_id = category.organization_id AND rate.tax_category_id = category.id AND rate.status = 'active'
         AND rate.effective_from > $2::date ORDER BY rate.effective_from LIMIT 1) next_rate ON true
   WHERE category.organization_id = $1`;

function toCategory(row) {
  const number = (value) => (value === null || value === undefined ? null : Number(value));
  const rate = number(row.rate);
  const gst = row.tax_type === "gst";
  return {
    id: row.id, code: row.code, name: row.name, description: row.description ?? null,
    taxType: row.tax_type, taxTypeLabel: labelOf(TAX_TYPES, row.tax_type), treatment: row.treatment, treatmentLabel: labelOf(TAX_TREATMENTS, row.treatment),
    appliesTo: row.applies_to, appliesToLabel: labelOf(TAX_APPLIES_TO, row.applies_to), countryCode: row.country_code?.trim() ?? null, reverseCharge: Boolean(row.reverse_charge),
    isActive: row.status === "active",
    rateId: row.rate_id ?? null, rate, cessRate: number(row.cess_rate) ?? 0, effectiveFrom: dayOf(row.effective_from), effectiveTo: dayOf(row.effective_to),
    // How the rate is charged, in words an accountant reads at a glance.
    components: row.treatment !== "taxable" || row.tax_type === "none" || rate === null ? []
      : gst
        ? [{ when: "Within the state", parts: rate ? [`CGST ${rate / 2}%`, `SGST ${rate / 2}%`] : ["No GST"] }, { when: "Between states", parts: rate ? [`IGST ${rate}%`] : ["No GST"] }]
          .map((entry) => (Number(row.cess_rate) ? { ...entry, parts: [...entry.parts, `CESS ${Number(row.cess_rate)}%`] } : entry))
        : [{ when: "Always", parts: [`${labelOf(TAX_TYPES, row.tax_type)} ${rate}%`] }],
    nextRate: row.next_effective_from ? { rate: number(row.next_rate), cessRate: number(row.next_cess_rate) ?? 0, effectiveFrom: dayOf(row.next_effective_from) } : null,
    productCount: row.product_count ?? 0,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// filters: search, status ("active" | "inactive"), treatment, taxType, rate, asOf (a date; default today)
export async function listTaxCategories(client, context, filters = {}) {
  requireTaxPermission(context, TAX_PERMISSIONS.view, "You do not have permission to view tax configuration.");
  const values = [context.organizationId, filters.asOf ? day(filters.asOf, "As of") : await today(client)];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  let where = "";
  if (filters.status === "active" || filters.status === "inactive") where += ` AND category.status = ${bind(filters.status)}`;
  if (codeOf(TAX_TREATMENTS).includes(filters.treatment)) where += ` AND category.treatment = ${bind(filters.treatment)}`;
  if (codeOf(TAX_TYPES).includes(filters.taxType)) where += ` AND category.tax_type = ${bind(filters.taxType)}`;
  if (filters.rate !== undefined && filters.rate !== null && filters.rate !== "") where += ` AND current_rate.rate = ${bind(percentage(filters.rate, "rate"))}`;
  const search = text(filters.search, 100);
  if (search) { const term = bind(`%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`); where += ` AND (category.code ILIKE ${term} OR category.name ILIKE ${term})`; }
  const { rows } = await client.query(`${CATEGORY_SQL}${where} ORDER BY category.status, current_rate.rate NULLS LAST, lower(category.name)`, values);
  return rows.map(toCategory);
}

async function loadCategory(client, context, categoryId, { lock = false } = {}) {
  const id = requireUuid(categoryId, "Tax category");
  if (lock) {
    const locked = await client.query(`SELECT id FROM tenant.tax_categories WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, id]);
    if (!locked.rows[0]) throw new TaxError(404, "Tax category not found.", "TAX_CATEGORY_NOT_FOUND");
  }
  const { rows } = await client.query(`${CATEGORY_SQL} AND category.id = $3`, [context.organizationId, await today(client), id]);
  if (!rows[0]) throw new TaxError(404, "Tax category not found.", "TAX_CATEGORY_NOT_FOUND");
  return rows[0];
}

// The category with every rate it has had, newest first.
export async function getTaxCategory(client, context, categoryId) {
  requireTaxPermission(context, TAX_PERMISSIONS.view, "You do not have permission to view tax configuration.");
  const row = await loadCategory(client, context, categoryId);
  const rates = await client.query(
    `SELECT rate.id, rate.rate, rate.cess_rate, rate.effective_from, rate.effective_to, rate.status, rate.version, rate.created_at, author.full_name AS created_by_name
       FROM tenant.tax_rates rate LEFT JOIN public.users author ON author.id = rate.created_by
      WHERE rate.organization_id = $1 AND rate.tax_category_id = $2 ORDER BY rate.effective_from DESC, rate.created_at DESC`, [context.organizationId, row.id]);
  return {
    ...toCategory(row),
    rates: rates.rows.map((rate) => ({
      id: rate.id, rate: Number(rate.rate), cessRate: Number(rate.cess_rate), effectiveFrom: dayOf(rate.effective_from), effectiveTo: dayOf(rate.effective_to),
      isActive: rate.status === "active", version: rate.version, createdAt: rate.created_at, createdByName: rate.created_by_name ?? null,
    })),
  };
}

function readCategory(input, current = null) {
  const pick = (key, column, fallback) => (has(input, key) ? input[key] : current ? current[column] : fallback);
  const code = (text(pick("code", "code", ""), 40) ?? "").toUpperCase().replace(/\s+/g, "-");
  const name = text(pick("name", "name", ""), 120);
  if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(code)) throw invalid("Enter a code using letters, digits, dots, dashes or underscores (for example GST-18).", "code");
  if (!name) throw invalid("Enter the tax category name.", "name");
  const taxType = pick("taxType", "tax_type", "gst");
  const treatment = pick("treatment", "treatment", "taxable");
  const appliesTo = pick("appliesTo", "applies_to", "all");
  if (!codeOf(TAX_TYPES).includes(taxType)) throw invalid("Choose the tax type.", "taxType");
  if (!codeOf(TAX_TREATMENTS).includes(treatment)) throw invalid("Choose the tax treatment.", "treatment");
  if (!codeOf(TAX_APPLIES_TO).includes(appliesTo)) throw invalid("Choose whether the category is for goods, services or both.", "appliesTo");
  return { code, name, description: text(pick("description", "description", null), 1000), taxType, treatment, appliesTo, reverseCharge: Boolean(pick("reverseCharge", "reverse_charge", false)) };
}

async function insertRate(client, context, category, { rate, cessRate, effectiveFrom, version = 1 }) {
  return (await client.query(
    `INSERT INTO tenant.tax_rates (organization_id, tax_category_id, name, code, tax_type, rate, cess_rate, effective_from, version, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING id`,
    [context.organizationId, category.id, category.name, `${category.code}-V${version}`, category.tax_type === "none" ? "other" : category.tax_type, rate, cessRate, effectiveFrom, version, context.userId ?? null])).rows[0].id;
}

// input: code, name, description?, taxType?, treatment?, appliesTo?, reverseCharge?, rate, cessRate?, effectiveFrom?
// A taxable category starts with its rate; exempt, zero-rated and outside-tax categories charge nothing.
export async function createTaxCategory(client, context, input = {}) {
  requireTaxPermission(context, TAX_PERMISSIONS.manageCategories, "You do not have permission to manage tax categories.");
  const values = readCategory(input);
  const charges = values.treatment === "taxable" && values.taxType !== "none";
  const rate = charges ? percentage(input.rate, "the tax rate") : 0;
  const cessRate = charges ? percentage(input.cessRate, "the CESS rate", { maximum: 1000, required: false }) : 0;
  const effectiveFrom = input.effectiveFrom ? day(input.effectiveFrom, "Effective from") : "2017-07-01";
  if ((await client.query(`SELECT 1 FROM tenant.tax_categories WHERE organization_id = $1 AND upper(code) = $2`, [context.organizationId, values.code])).rows[0])
    throw new TaxError(409, `A tax category with the code ${values.code} already exists.`, "TAX_CATEGORY_CODE_EXISTS", { field: "code" });
  const country = (await client.query(`SELECT country_code FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0]?.country_code ?? null;
  const category = (await client.query(
    `INSERT INTO tenant.tax_categories (organization_id, code, name, description, tax_type, treatment, applies_to, reverse_charge, country_code, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING *`,
    [context.organizationId, values.code, values.name, values.description, values.taxType, values.treatment, values.appliesTo, values.reverseCharge, country, context.userId ?? null])).rows[0];
  if (charges) await insertRate(client, context, category, { rate, cessRate, effectiveFrom });
  await record(client, context, "tax_category", category.id, "created", `Tax category ${category.code} created${charges ? ` at ${rate}%${cessRate ? ` + CESS ${cessRate}%` : ""}` : ""}`,
    { code: category.code, name: category.name, treatment: category.treatment, taxType: category.tax_type, rate, cessRate, effectiveFrom: charges ? effectiveFrom : null });
  return getTaxCategory(client, context, category.id);
}

// input: name?, description?, appliesTo?, reverseCharge?, and (while no product or document uses it) code?, taxType?, treatment?
// The rate is changed with changeTaxRate.
export async function updateTaxCategory(client, context, categoryId, input = {}) {
  requireTaxPermission(context, TAX_PERMISSIONS.manageCategories, "You do not have permission to manage tax categories.");
  const current = await loadCategory(client, context, categoryId, { lock: true });
  const values = readCategory(input, current);
  const identityChanged = values.code !== current.code || values.taxType !== current.tax_type || values.treatment !== current.treatment;
  if (identityChanged) {
    const used = current.product_count > 0 || (await client.query(
      `SELECT 1 FROM tenant.sales_quotation_tax_lines WHERE organization_id = $1 AND tax_category_id = $2
       UNION ALL SELECT 1 FROM tenant.sales_order_tax_lines WHERE organization_id = $1 AND tax_category_id = $2 LIMIT 1`, [context.organizationId, current.id])).rows[0];
    if (used) throw new TaxError(409, "The code, tax type and treatment cannot change once the category is used. Create a new category instead.", "TAX_CATEGORY_IN_USE");
    if ((await client.query(`SELECT 1 FROM tenant.tax_categories WHERE organization_id = $1 AND upper(code) = $2 AND id <> $3`, [context.organizationId, values.code, current.id])).rows[0])
      throw new TaxError(409, `A tax category with the code ${values.code} already exists.`, "TAX_CATEGORY_CODE_EXISTS", { field: "code" });
  }
  const changes = {};
  for (const [key, column] of [["code", "code"], ["name", "name"], ["description", "description"], ["taxType", "tax_type"], ["treatment", "treatment"], ["appliesTo", "applies_to"], ["reverseCharge", "reverse_charge"]])
    if ((values[key] ?? null) !== (current[column] ?? null)) changes[key] = { from: current[column] ?? null, to: values[key] ?? null };
  if (Object.keys(changes).length) {
    await client.query(
      `UPDATE tenant.tax_categories SET code = $3, name = $4, description = $5, tax_type = $6, treatment = $7, applies_to = $8, reverse_charge = $9, updated_by = $10, updated_at = now()
        WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, current.id, values.code, values.name, values.description, values.taxType, values.treatment, values.appliesTo, values.reverseCharge, context.userId ?? null]);
    await record(client, context, "tax_category", current.id, "updated", `Tax category ${values.code} changed: ${Object.keys(changes).join(", ")}`, changes);
  }
  return getTaxCategory(client, context, current.id);
}

// Inactive: no longer offered on products or charged on new documents; existing documents keep it.
export async function setTaxCategoryStatus(client, context, categoryId, active) {
  requireTaxPermission(context, TAX_PERMISSIONS.manageCategories, "You do not have permission to manage tax categories.");
  const current = await loadCategory(client, context, categoryId, { lock: true });
  const status = active ? "active" : "inactive";
  if (current.status !== status) {
    await client.query(`UPDATE tenant.tax_categories SET status = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, current.id, status, context.userId ?? null]);
    if (!active) await client.query(`UPDATE tenant.tax_settings SET default_tax_category_id = NULL WHERE organization_id = $1 AND default_tax_category_id = $2`, [context.organizationId, current.id]);
    await record(client, context, "tax_category", current.id, active ? "activated" : "deactivated",
      `Tax category ${current.code} ${active ? "activated" : `deactivated${current.product_count ? ` (${current.product_count} product(s) still use it)` : ""}`}`, { status: { from: current.status, to: status } });
  }
  return getTaxCategory(client, context, current.id);
}

// Ends the category's current rate the day before `effectiveFrom` and starts
// the new rate on it. Documents dated earlier keep the old rate.
// input: { rate, cessRate?, effectiveFrom }
export async function changeTaxRate(client, context, categoryId, input = {}) {
  requireTaxPermission(context, TAX_PERMISSIONS.manageRates, "You do not have permission to change tax rates.");
  const category = await loadCategory(client, context, categoryId, { lock: true });
  if (category.treatment !== "taxable" || category.tax_type === "none")
    throw new TaxError(409, `${category.name} is ${labelOf(TAX_TREATMENTS, category.treatment).toLowerCase()} and has no rate.`, "TAX_CATEGORY_HAS_NO_RATE");
  const rate = percentage(input.rate, "the tax rate");
  const cessRate = percentage(input.cessRate, "the CESS rate", { maximum: 1000, required: false });
  const effectiveFrom = day(input.effectiveFrom, "Effective from");
  // The open rate is the last one: the rate in force, or one already scheduled.
  const open = (await client.query(
    `SELECT id, rate, cess_rate, effective_from, version FROM tenant.tax_rates WHERE organization_id = $1 AND tax_category_id = $2 AND status = 'active' AND effective_to IS NULL FOR UPDATE`,
    [context.organizationId, category.id])).rows[0];
  if (open) {
    if (Number(open.rate) === rate && Number(open.cess_rate) === cessRate) throw new TaxError(409, "That is already the rate.", "TAX_RATE_UNCHANGED");
    if (effectiveFrom <= dayOf(open.effective_from))
      throw new TaxError(409, `The new rate must start after ${dayOf(open.effective_from)}, when the current rate started.`, "TAX_RATE_DATE_INVALID", { field: "effectiveFrom" });
    await client.query(`UPDATE tenant.tax_rates SET effective_to = ($3::date - 1), updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, open.id, effectiveFrom, context.userId ?? null]);
  } else {
    const last = (await client.query(`SELECT max(effective_to) AS ended FROM tenant.tax_rates WHERE organization_id = $1 AND tax_category_id = $2 AND status = 'active'`,
      [context.organizationId, category.id])).rows[0]?.ended;
    if (last && effectiveFrom <= dayOf(last)) throw new TaxError(409, `The new rate must start after ${dayOf(last)}.`, "TAX_RATE_DATE_INVALID", { field: "effectiveFrom" });
  }
  const rateId = await insertRate(client, context, category, { rate, cessRate, effectiveFrom, version: Number(open?.version ?? 0) + 1 });
  await record(client, context, "tax_rate", category.id, "rate_changed",
    `${category.code}: ${open ? `${Number(open.rate)}%` : "no rate"} → ${rate}%${cessRate ? ` + CESS ${cessRate}%` : ""} from ${effectiveFrom}`,
    { rate: { from: open ? Number(open.rate) : null, to: rate }, cessRate: { from: open ? Number(open.cess_rate) : null, to: cessRate }, effectiveFrom, rateId, endedRateId: open?.id ?? null });
  return getTaxCategory(client, context, category.id);
}

// ------------------------------------------------------------ company registrations

const toRegistration = (row) => ({
  id: row.id, code: row.code, name: row.name, legalName: row.legal_name ?? null, registrationNumber: row.registration_number ?? null,
  countryCode: row.country_code?.trim() ?? null, stateCode: row.state_code ?? null, stateName: row.state_name ?? gstStateName(row.state_code),
  addressLine1: row.address_line1 ?? null, addressLine2: row.address_line2 ?? null, city: row.city ?? null, postalCode: row.postal_code ?? null,
  isDefault: Boolean(row.is_default), isActive: row.status === "active", createdAt: row.created_at, updatedAt: row.updated_at,
});

export async function listTaxRegistrations(client, context, filters = {}) {
  requireTaxPermission(context, TAX_PERMISSIONS.view, "You do not have permission to view tax configuration.");
  const { rows } = await client.query(
    `SELECT * FROM tenant.tax_registrations WHERE organization_id = $1${filters.status === "active" ? " AND status = 'active'" : ""} ORDER BY is_default DESC, status, lower(name)`,
    [context.organizationId]);
  return rows.map(toRegistration);
}

function readRegistration(input, current = null) {
  const pick = (key, column) => (has(input, key) ? input[key] : current ? current[column] : null);
  const code = (text(pick("code", "code"), 40) ?? "").toUpperCase().replace(/\s+/g, "-");
  const name = text(pick("name", "name"), 160);
  if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(code)) throw invalid("Enter a short code for the registration (for example MH).", "code");
  if (!name) throw invalid("Enter the registration name (for example Maharashtra).", "name");
  const countryCode = (text(pick("countryCode", "country_code"), 2) ?? "IN").toUpperCase();
  const registrationNumber = text(pick("registrationNumber", "registration_number"), 40)?.toUpperCase().replace(/\s+/g, "") ?? null;
  let stateCode = text(pick("stateCode", "state_code"), 10);
  if (countryCode === "IN") {
    if (registrationNumber && !GSTIN_PATTERN.test(registrationNumber)) throw invalid("Enter a valid 15-character GSTIN.", "registrationNumber");
    if (registrationNumber && !stateCode) stateCode = registrationNumber.slice(0, 2);
    if (!stateCode || !gstStateName(stateCode)) throw invalid("Choose the state of the registration.", "stateCode");
    if (registrationNumber && registrationNumber.slice(0, 2) !== stateCode)
      throw invalid(`The GSTIN belongs to ${gstStateName(registrationNumber.slice(0, 2)) ?? "another state"}, not ${gstStateName(stateCode)}.`, "registrationNumber");
  }
  return {
    code, name, legalName: text(pick("legalName", "legal_name"), 200), registrationNumber, countryCode, stateCode,
    stateName: countryCode === "IN" ? gstStateName(stateCode) : text(pick("stateName", "state_name"), 120),
    addressLine1: text(pick("addressLine1", "address_line1"), 200), addressLine2: text(pick("addressLine2", "address_line2"), 200), city: text(pick("city", "city"), 120),
    postalCode: text(pick("postalCode", "postal_code"), 20),
  };
}

async function assertRegistrationUnique(client, context, values, exceptId = null) {
  const { rows } = await client.query(
    `SELECT code, registration_number FROM tenant.tax_registrations
      WHERE organization_id = $1 AND ($4::uuid IS NULL OR id <> $4) AND (upper(code) = $2 OR ($3::text IS NOT NULL AND upper(registration_number) = $3))`,
    [context.organizationId, values.code, values.registrationNumber, exceptId]);
  if (!rows[0]) return;
  if (rows[0].code.toUpperCase() === values.code) throw new TaxError(409, `A registration with the code ${values.code} already exists.`, "TAX_REGISTRATION_EXISTS", { field: "code" });
  throw new TaxError(409, `${values.registrationNumber} is already registered.`, "TAX_REGISTRATION_EXISTS", { field: "registrationNumber" });
}

// input: code, name, legalName?, registrationNumber (GSTIN)?, stateCode, countryCode?, address…, isDefault?
// The first registration becomes the default one.
export async function createTaxRegistration(client, context, input = {}) {
  requireTaxPermission(context, TAX_PERMISSIONS.manageRegistrations, "You do not have permission to manage company tax registrations.");
  const values = readRegistration(input);
  await assertRegistrationUnique(client, context, values);
  const first = !(await client.query(`SELECT 1 FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active'`, [context.organizationId])).rows[0];
  const makeDefault = first || input.isDefault === true;
  if (makeDefault) await client.query(`UPDATE tenant.tax_registrations SET is_default = false WHERE organization_id = $1 AND is_default`, [context.organizationId]);
  const row = (await client.query(
    `INSERT INTO tenant.tax_registrations (organization_id, code, name, legal_name, registration_number, country_code, state_code, state_name, address_line1, address_line2, city,
        postal_code, is_default, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14) RETURNING *`,
    [context.organizationId, values.code, values.name, values.legalName, values.registrationNumber, values.countryCode, values.stateCode, values.stateName, values.addressLine1,
      values.addressLine2, values.city, values.postalCode, makeDefault, context.userId ?? null])).rows[0];
  await record(client, context, "tax_registration", row.id, "created", `Tax registration ${row.name}${row.registration_number ? ` (${row.registration_number})` : ""} added`,
    { code: row.code, registrationNumber: row.registration_number, stateCode: row.state_code, isDefault: makeDefault });
  return toRegistration(row);
}

// input: any of the create fields, isDefault?, isActive?
export async function updateTaxRegistration(client, context, registrationId, input = {}) {
  requireTaxPermission(context, TAX_PERMISSIONS.manageRegistrations, "You do not have permission to manage company tax registrations.");
  const current = (await client.query(`SELECT * FROM tenant.tax_registrations WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [context.organizationId, requireUuid(registrationId, "Tax registration")])).rows[0];
  if (!current) throw new TaxError(404, "Tax registration not found.", "TAX_REGISTRATION_NOT_FOUND");
  const values = readRegistration(input, current);
  await assertRegistrationUnique(client, context, values, current.id);
  const status = has(input, "isActive") ? (input.isActive ? "active" : "inactive") : current.status;
  let isDefault = has(input, "isDefault") ? Boolean(input.isDefault) : current.is_default;
  if (status === "inactive") {
    if (current.is_default && (await client.query(`SELECT 1 FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active' AND id <> $2`, [context.organizationId, current.id])).rows[0])
      throw new TaxError(409, "Make another registration the default before deactivating this one.", "TAX_REGISTRATION_DEFAULT");
    isDefault = false;
  }
  if (current.is_default && !isDefault && status === "active") throw new TaxError(409, "Choose the new default registration instead.", "TAX_REGISTRATION_DEFAULT");
  if (isDefault && !current.is_default) await client.query(`UPDATE tenant.tax_registrations SET is_default = false WHERE organization_id = $1 AND is_default`, [context.organizationId]);
  const changes = {};
  for (const [key, column] of [["code", "code"], ["name", "name"], ["legalName", "legal_name"], ["registrationNumber", "registration_number"], ["stateCode", "state_code"],
    ["addressLine1", "address_line1"], ["addressLine2", "address_line2"], ["city", "city"], ["postalCode", "postal_code"]])
    if ((values[key] ?? null) !== (current[column] ?? null)) changes[key] = { from: current[column] ?? null, to: values[key] ?? null };
  if (status !== current.status) changes.status = { from: current.status, to: status };
  if (isDefault !== current.is_default) changes.isDefault = { from: current.is_default, to: isDefault };
  const row = (await client.query(
    `UPDATE tenant.tax_registrations
        SET code = $3, name = $4, legal_name = $5, registration_number = $6, country_code = $7, state_code = $8, state_name = $9, address_line1 = $10, address_line2 = $11, city = $12,
            postal_code = $13, is_default = $14, status = $15, updated_by = $16, updated_at = now()
      WHERE organization_id = $1 AND id = $2 RETURNING *`,
    [context.organizationId, current.id, values.code, values.name, values.legalName, values.registrationNumber, values.countryCode, values.stateCode, values.stateName,
      values.addressLine1, values.addressLine2, values.city, values.postalCode, isDefault, status, context.userId ?? null])).rows[0];
  if (Object.keys(changes).length)
    await record(client, context, "tax_registration", row.id, changes.status ? (status === "active" ? "activated" : "deactivated") : "updated",
      `Tax registration ${row.name} changed: ${Object.keys(changes).join(", ")}`, changes);
  return toRegistration(row);
}

// ------------------------------------------------------------ defaults

export async function getTaxSettings(client, context) {
  requireTaxPermission(context, TAX_PERMISSIONS.view, "You do not have permission to view tax configuration.");
  const row = (await client.query(
    `SELECT organization.country_code, COALESCE(settings.tax_enabled, true) AS tax_enabled, settings.default_tax_category_id, category.name AS default_tax_category_name
       FROM public.organizations organization
       LEFT JOIN tenant.tax_settings settings ON settings.organization_id = organization.id
       LEFT JOIN tenant.tax_categories category ON category.id = settings.default_tax_category_id
      WHERE organization.id = $1`, [context.organizationId])).rows[0] ?? {};
  return {
    countryCode: row.country_code?.trim() ?? null, taxEnabled: row.tax_enabled !== false, defaultTaxCategoryId: row.default_tax_category_id ?? null,
    defaultTaxCategoryName: row.default_tax_category_name ?? null,
  };
}

// input: { taxEnabled?, defaultTaxCategoryId? }. With tax switched off, no document is taxed.
export async function updateTaxSettings(client, context, input = {}) {
  requireTaxPermission(context, TAX_PERMISSIONS.manageRegistrations, "You do not have permission to change tax defaults.");
  const current = await getTaxSettings(client, context);
  const taxEnabled = has(input, "taxEnabled") ? Boolean(input.taxEnabled) : current.taxEnabled;
  let defaultTaxCategoryId = has(input, "defaultTaxCategoryId") ? input.defaultTaxCategoryId || null : current.defaultTaxCategoryId;
  if (defaultTaxCategoryId && !(await client.query(`SELECT 1 FROM tenant.tax_categories WHERE organization_id = $1 AND id = $2 AND status = 'active'`,
    [context.organizationId, requireUuid(defaultTaxCategoryId, "Default tax category")])).rows[0])
    throw new TaxError(409, "Choose an active tax category as the default.", "TAX_CATEGORY_INVALID", { field: "defaultTaxCategoryId" });
  await client.query(
    `INSERT INTO tenant.tax_settings (organization_id, tax_enabled, default_tax_category_id, created_by, updated_by) VALUES ($1, $2, $3, $4, $4)
     ON CONFLICT (organization_id) DO UPDATE SET tax_enabled = EXCLUDED.tax_enabled, default_tax_category_id = EXCLUDED.default_tax_category_id, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, taxEnabled, defaultTaxCategoryId, context.userId ?? null]);
  const changes = {};
  if (taxEnabled !== current.taxEnabled) changes.taxEnabled = { from: current.taxEnabled, to: taxEnabled };
  if (defaultTaxCategoryId !== current.defaultTaxCategoryId) changes.defaultTaxCategoryId = { from: current.defaultTaxCategoryId, to: defaultTaxCategoryId };
  if (Object.keys(changes).length) await record(client, context, "tax_settings", null, "updated", `Tax defaults changed: ${Object.keys(changes).join(", ")}`, changes);
  return getTaxSettings(client, context);
}

// Everything the Taxes settings page and the document forms need to offer choices.
export async function getTaxOptions(client, context) {
  requireTaxPermission(context, TAX_PERMISSIONS.view, "You do not have permission to view tax configuration.");
  return {
    taxTypes: TAX_TYPES, treatments: TAX_TREATMENTS, appliesTo: TAX_APPLIES_TO, supplyTypes: SUPPLY_TYPES.map(({ code, label }) => ({ code, label })), states: GST_STATES,
    settings: await getTaxSettings(client, context),
    registrations: await listTaxRegistrations(client, context, { status: "active" }),
    capabilities: Object.fromEntries(Object.entries(TAX_PERMISSIONS).map(([name, permission]) => [name, can(context, permission)])),
  };
}

// The active tax categories for a picker on a product or item form (id, code,
// name and today's rate). Anyone who can open such a form may read them.
export async function listTaxCategoryChoices(client, context) {
  const { rows } = await client.query(`${CATEGORY_SQL} AND category.status = 'active' ORDER BY current_rate.rate NULLS LAST, lower(category.name)`,
    [context.organizationId, await today(client)]);
  return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, treatment: row.treatment, appliesTo: row.applies_to, rate: row.rate === null ? null : Number(row.rate) }));
}
