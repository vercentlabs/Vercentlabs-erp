// Quotation templates (Sales report Phase 2): a ready-made start for a quotation — "Standard distributor offer", "Annual maintenance" —
// with its lines, headings and notes, how many days it stays valid, the terms, payment terms and the note to the customer. A template
// fills the New quotation form; what is saved is an ordinary quotation, priced from today's price list. Setting templates up needs the
// Sales settings permission; using one needs Create quotations.
import { SalesError } from "../index.js";
import { readSectionLines } from "../section-lines.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value, max) => String(value ?? "").trim().slice(0, max);
const can = (context, permission) => Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission));
const invalid = (message, field) => new SalesError(400, message, "SALES_TEMPLATE_INVALID", { field });

function requireManage(context) {
  if (!can(context, "sales.settings.manage")) throw new SalesError(403, "You do not have permission to set up quotation templates.", "PERMISSION_DENIED");
}
function requireUse(context) {
  if (!can(context, "sales.quotation.create") && !can(context, "sales.settings.manage"))
    throw new SalesError(403, "You do not have permission to use quotation templates.", "PERMISSION_DENIED");
}

const view = (row) => ({
  id: row.id, name: row.name, description: row.description, validityDays: row.validity_days, paymentTermId: row.payment_term_id,
  termsAndConditions: row.terms_and_conditions, customerNotes: row.customer_notes, lines: row.lines ?? [], sectionLines: row.section_lines ?? [],
  active: row.status === "active", updatedAt: row.updated_at, lineCount: (row.lines ?? []).length,
});

// The lines a template keeps: product, quantity, unit, description, line discount. Products must exist and be sold.
async function readLines(client, context, value) {
  if (!Array.isArray(value) || !value.length) throw invalid("Add at least one product.", "lines");
  if (value.length > 200) throw invalid("A template holds at most 200 lines.", "lines");
  const lines = value.map((line, index) => {
    const itemId = String(line?.itemId ?? "");
    const quantity = Number(line?.quantity);
    if (!UUID.test(itemId)) throw invalid(`Line ${index + 1}: choose a product.`, "lines");
    if (!(quantity > 0)) throw invalid(`Line ${index + 1}: enter a quantity above 0.`, "lines");
    const discountValue = Number(line?.discountValue ?? 0);
    const discountType = line?.discountType === "amount" ? "amount" : "percent";
    if (!Number.isFinite(discountValue) || discountValue < 0 || (discountType === "percent" && discountValue > 100))
      throw invalid(`Line ${index + 1}: the discount is not valid.`, "lines");
    return {
      itemId, quantity, uomId: UUID.test(String(line?.uomId ?? "")) ? String(line.uomId) : null, description: text(line?.description, 2000) || null,
      ...(discountValue > 0 ? { discountType, discountValue } : {}),
    };
  });
  const ids = [...new Set(lines.map((line) => line.itemId))];
  const found = (await client.query("SELECT id FROM tenant.items WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND is_sellable AND status = 'active'",
    [context.organizationId, ids])).rows.map((row) => row.id);
  const missing = lines.findIndex((line) => !found.includes(line.itemId));
  if (missing >= 0) throw invalid(`Line ${missing + 1}: choose an active product that is sold.`, "lines");
  return lines;
}

async function readTemplate(client, context, input, current = null) {
  const pick = (key, column) => (Object.prototype.hasOwnProperty.call(input, key) ? input[key] : current?.[column]);
  const name = text(pick("name", "name"), 120);
  if (!name) throw invalid("Name the template.", "name");
  const validity = pick("validityDays", "validity_days");
  const validityDays = validity === null || validity === undefined || validity === "" ? null : Number(validity);
  if (validityDays !== null && (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 365)) throw invalid("Enter between 1 and 365 days.", "validityDays");
  const paymentTermId = pick("paymentTermId", "payment_term_id") || null;
  if (paymentTermId && !(await client.query("SELECT 1 FROM tenant.payment_terms WHERE organization_id = $1 AND id = $2", [context.organizationId, paymentTermId]).catch(() => ({ rows: [] }))).rows[0])
    throw invalid("Choose payment terms from the list.", "paymentTermId");
  const lines = Object.prototype.hasOwnProperty.call(input, "lines") ? await readLines(client, context, input.lines) : current.lines;
  const sectionLines = Object.prototype.hasOwnProperty.call(input, "sectionLines") ? readSectionLines(input.sectionLines, lines.length) : (current?.section_lines ?? []);
  const clash = (await client.query(
    "SELECT 1 FROM tenant.sales_quotation_templates WHERE organization_id = $1 AND status = 'active' AND lower(name) = lower($2) AND ($3::uuid IS NULL OR id <> $3)",
    [context.organizationId, name, current?.id ?? null])).rows[0];
  if (clash) throw invalid(`Another template is already called "${name}".`, "name");
  return {
    name, description: text(pick("description", "description"), 500) || null, validityDays, paymentTermId,
    termsAndConditions: text(pick("termsAndConditions", "terms_and_conditions"), 20000) || null, customerNotes: text(pick("customerNotes", "customer_notes"), 10000) || null,
    lines, sectionLines,
  };
}

async function loadTemplate(client, context, templateId, { lock = false } = {}) {
  if (!UUID.test(String(templateId ?? ""))) throw new SalesError(404, "Template not found.", "SALES_TEMPLATE_NOT_FOUND");
  const row = (await client.query(`SELECT * FROM tenant.sales_quotation_templates WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [context.organizationId, templateId])).rows[0];
  if (!row) throw new SalesError(404, "Template not found.", "SALES_TEMPLATE_NOT_FOUND");
  return row;
}

// options: { includeInactive? } — the active ones for New quotation; all of them for Setup.
export async function listQuotationTemplates(client, context, options = {}) {
  requireUse(context);
  const all = options.includeInactive === true && can(context, "sales.settings.manage");
  const rows = (await client.query(
    `SELECT * FROM tenant.sales_quotation_templates WHERE organization_id = $1 AND ($2 OR status = 'active') ORDER BY status, lower(name)`, [context.organizationId, all])).rows;
  return { templates: rows.map(view) };
}

export async function getQuotationTemplate(client, context, templateId) {
  requireUse(context);
  return { template: view(await loadTemplate(client, context, templateId)) };
}

export async function createQuotationTemplate(client, context, input = {}) {
  requireManage(context);
  const values = await readTemplate(client, context, input);
  const row = (await client.query(
    `INSERT INTO tenant.sales_quotation_templates (organization_id, name, description, validity_days, payment_term_id, terms_and_conditions, customer_notes, lines, section_lines,
       created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $10) RETURNING *`,
    [context.organizationId, values.name, values.description, values.validityDays, values.paymentTermId, values.termsAndConditions, values.customerNotes,
      JSON.stringify(values.lines), JSON.stringify(values.sectionLines), context.userId ?? null])).rows[0];
  return { template: view(row) };
}

export async function updateQuotationTemplate(client, context, templateId, input = {}) {
  requireManage(context);
  const current = await loadTemplate(client, context, templateId, { lock: true });
  const values = await readTemplate(client, context, input, current);
  const row = (await client.query(
    `UPDATE tenant.sales_quotation_templates SET name = $3, description = $4, validity_days = $5, payment_term_id = $6, terms_and_conditions = $7, customer_notes = $8,
            lines = $9::jsonb, section_lines = $10::jsonb, updated_by = $11, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING *`,
    [context.organizationId, current.id, values.name, values.description, values.validityDays, values.paymentTermId, values.termsAndConditions, values.customerNotes,
      JSON.stringify(values.lines), JSON.stringify(values.sectionLines), context.userId ?? null])).rows[0];
  return { template: view(row) };
}

export async function setQuotationTemplateActive(client, context, templateId, active) {
  requireManage(context);
  const current = await loadTemplate(client, context, templateId, { lock: true });
  if (active && current.status !== "active") {
    const clash = (await client.query("SELECT 1 FROM tenant.sales_quotation_templates WHERE organization_id = $1 AND status = 'active' AND lower(name) = lower($2)",
      [context.organizationId, current.name])).rows[0];
    if (clash) throw invalid(`Another template is already called "${current.name}". Rename one first.`, "name");
  }
  const row = (await client.query("UPDATE tenant.sales_quotation_templates SET status = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING *",
    [context.organizationId, current.id, active ? "active" : "inactive", context.userId ?? null])).rows[0];
  return { template: view(row) };
}

// Templates are never used by documents after they fill the form, so one can be deleted at any time.
export async function deleteQuotationTemplate(client, context, templateId) {
  requireManage(context);
  const current = await loadTemplate(client, context, templateId, { lock: true });
  await client.query("DELETE FROM tenant.sales_quotation_templates WHERE organization_id = $1 AND id = $2", [context.organizationId, current.id]);
  return { deleted: true };
}
