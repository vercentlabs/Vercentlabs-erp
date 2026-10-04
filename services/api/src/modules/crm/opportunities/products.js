// What is being sold on a deal: lightweight product lines from the shared
// Products and Services master, with an estimated price. They are an
// estimate, not a quotation: prices, taxes and terms are settled when a
// quotation is created from the opportunity, which starts from these lines.
//
// The lines never overwrite the deal's estimated value by themselves; the
// salesperson can choose to set the value to the lines' total.
import { CrmError } from "../data-management/errors.js";
import { requireOpportunityPermission } from "./access.js";
import { OPPORTUNITY_PERMISSIONS } from "./constants.js";
import { recordOpportunityHistory } from "./history.js";
import { assertOpen, getOpportunity, lockOpportunity, requireUuid } from "./records.js";

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const text = (value) => String(value ?? "").trim();
const invalid = (message) => new CrmError(400, message, "CRM_OPPORTUNITY_PRODUCT_VALIDATION");
const round = (value) => Math.round(value * 100) / 100;

function toLine(row) {
  return {
    id: row.id, productId: row.item_id, productCode: row.item_code ?? null, productName: row.item_name ?? null, description: row.description,
    quantity: Number(row.quantity), unitPrice: Number(row.unit_price), discountPercent: Number(row.discount_percent ?? 0),
    // quantity × price less the discount; the database calculates it
    lineTotal: Number(row.line_subtotal ?? 0),
  };
}

const LINE_SELECT = `SELECT line.*, item.code AS item_code, item.name AS item_name
    FROM tenant.crm_opportunity_items line
    LEFT JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id`;

async function listLines(client, context, opportunityId) {
  const { rows } = await client.query(`${LINE_SELECT} WHERE line.organization_id = $1 AND line.opportunity_id = $2 ORDER BY line.created_at, line.id`,
    [context.organizationId, opportunityId]);
  return rows.map(toLine);
}

export async function listOpportunityProducts(client, context, opportunityId) {
  const opportunity = await getOpportunity(client, context, opportunityId);
  const lines = await listLines(client, context, opportunity.id);
  return { lines, total: round(lines.reduce((sum, line) => sum + line.lineTotal, 0)), currencyCode: opportunity.currencyCode };
}

// Products and services that can be put on a deal.
export async function searchOpportunityProducts(client, context, search = "") {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.view, "You do not have permission to view opportunities.");
  const { rows } = await client.query(
    `SELECT id, code, name, item_type, sales_price FROM tenant.items
      WHERE organization_id = $1 AND status = 'active' AND ($2 = '' OR lower(name || ' ' || code) LIKE $2)
      ORDER BY lower(name) LIMIT 50`,
    [context.organizationId, text(search) ? `%${text(search).toLowerCase().replace(/[\\%_]/g, "\\$&")}%` : ""],
  );
  return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, type: row.item_type, salesPrice: Number(row.sales_price ?? 0) }));
}

function amounts(input, current = {}) {
  const quantity = has(input, "quantity") ? Number(input.quantity) : Number(current.quantity ?? 1);
  const unitPrice = has(input, "unitPrice") ? Number(input.unitPrice) : Number(current.unit_price ?? 0);
  const discountPercent = has(input, "discountPercent") ? Number(input.discountPercent || 0) : Number(current.discount_percent ?? 0);
  if (!Number.isFinite(quantity) || quantity <= 0) throw invalid("Enter a quantity greater than zero.");
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw invalid("Enter an estimated price of zero or more.");
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) throw invalid("Enter a discount from 0 to 100 percent.");
  return { quantity, unitPrice, discountPercent, total: round(quantity * unitPrice * (1 - discountPercent / 100)) };
}

// input: { productId (required), quantity?, unitPrice? (defaults to the product's sales price), discountPercent?, description? }
export async function addOpportunityProduct(client, context, opportunityId, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.edit, "You do not have permission to edit opportunities.");
  const opportunity = await lockOpportunity(client, context, opportunityId);
  assertOpen(opportunity, "changed");
  const product = (await client.query(`SELECT id, name, sales_price FROM tenant.items WHERE organization_id = $1 AND id = $2 AND status = 'active'`,
    [context.organizationId, requireUuid(input.productId, "Product")])).rows[0];
  if (!product) throw invalid("Choose a product or service from the list.");
  const line = amounts({ quantity: 1, unitPrice: product.sales_price ?? 0, ...input });
  const { rows } = await client.query(
    `INSERT INTO tenant.crm_opportunity_items (organization_id, opportunity_id, item_id, description, quantity, unit_price, discount_percent, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id`,
    [context.organizationId, opportunity.id, product.id, text(input.description).slice(0, 2000) || null, line.quantity, line.unitPrice, line.discountPercent, context.userId ?? null],
  );
  await recordOpportunityHistory(client, context, opportunity.id, "product_changed", `Product added: ${product.name}`, { productId: product.id, quantity: line.quantity, total: line.total });
  return (await listLines(client, context, opportunity.id)).find((entry) => entry.id === rows[0].id);
}

async function lockLine(client, context, opportunityId, lineId) {
  const { rows } = await client.query(`${LINE_SELECT} WHERE line.organization_id = $1 AND line.opportunity_id = $2 AND line.id = $3 FOR UPDATE OF line`,
    [context.organizationId, opportunityId, requireUuid(lineId, "Product line")]);
  if (!rows[0]) throw new CrmError(404, "Product line not found.", "CRM_OPPORTUNITY_PRODUCT_NOT_FOUND");
  return rows[0];
}

// input: { quantity?, unitPrice?, discountPercent?, description? }
export async function updateOpportunityProduct(client, context, opportunityId, lineId, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.edit, "You do not have permission to edit opportunities.");
  const opportunity = await lockOpportunity(client, context, opportunityId);
  assertOpen(opportunity, "changed");
  const current = await lockLine(client, context, opportunity.id, lineId);
  const line = amounts(input, current);
  await client.query(
    `UPDATE tenant.crm_opportunity_items SET quantity = $3, unit_price = $4, discount_percent = $5, description = $6, updated_by = $7, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, current.id, line.quantity, line.unitPrice, line.discountPercent,
      has(input, "description") ? text(input.description).slice(0, 2000) || null : current.description, context.userId ?? null],
  );
  await recordOpportunityHistory(client, context, opportunity.id, "product_changed", `Product changed: ${current.item_name}`, {
    productId: current.item_id, from: Number(current.line_subtotal ?? 0), to: line.total,
  });
  return (await listLines(client, context, opportunity.id)).find((entry) => entry.id === current.id);
}

export async function removeOpportunityProduct(client, context, opportunityId, lineId) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.edit, "You do not have permission to edit opportunities.");
  const opportunity = await lockOpportunity(client, context, opportunityId);
  assertOpen(opportunity, "changed");
  const current = await lockLine(client, context, opportunity.id, lineId);
  await client.query(`DELETE FROM tenant.crm_opportunity_items WHERE organization_id = $1 AND id = $2`, [context.organizationId, current.id]);
  await recordOpportunityHistory(client, context, opportunity.id, "product_changed", `Product removed: ${current.item_name}`, { productId: current.item_id });
  return { removed: true };
}
