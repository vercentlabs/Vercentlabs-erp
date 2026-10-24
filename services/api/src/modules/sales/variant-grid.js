// The variant grid (Sales report Phase 3): a product sold in sizes and colours is entered as one grid — sizes down, colours across —
// and each filled cell becomes a line for that variant. A template's variants are laid out by their first two attributes (one attribute:
// a single column). Only active, sellable variants appear; a missing combination is an empty cell.
import { SalesError } from "./index.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const can = (context, permission) => Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission));

function requireSales(context) {
  if (!can(context, "sales.quotation.create") && !can(context, "sales.order.create")) throw new SalesError(403, "You do not have permission to make quotations or orders.", "PERMISSION_DENIED");
}

// Templates with at least one sellable variant, by name or code. options: { search? }
export async function searchVariantTemplates(client, context, options = {}) {
  requireSales(context);
  const search = String(options.search ?? "").trim().slice(0, 100);
  const rows = (await client.query(
    `SELECT template.id, template.code, template.name, count(variant.id)::int AS variants
       FROM tenant.items template
       JOIN tenant.items variant ON variant.organization_id = template.organization_id AND variant.parent_item_id = template.id AND variant.status = 'active' AND variant.is_sellable
      WHERE template.organization_id = $1 AND template.is_variant_template AND template.status = 'active'
        AND ($2 = '' OR template.name ILIKE '%' || $2 || '%' OR template.code ILIKE '%' || $2 || '%')
      GROUP BY template.id ORDER BY template.name LIMIT 30`, [context.organizationId, search])).rows;
  return { templates: rows.map((row) => ({ id: row.id, code: row.code, name: row.name, variants: row.variants })) };
}

// Returns { template, rowAttribute, columnAttribute, rows: [value], columns: [value], cells: { "row|column": { itemId, code, name } } }.
export async function getVariantGrid(client, context, templateId) {
  requireSales(context);
  if (!UUID.test(String(templateId ?? ""))) throw new SalesError(404, "Product not found.", "SALES_PRODUCT_NOT_FOUND");
  const template = (await client.query("SELECT id, code, name FROM tenant.items WHERE organization_id = $1 AND id = $2 AND is_variant_template", [context.organizationId, templateId])).rows[0];
  if (!template) throw new SalesError(404, "This product has no variants.", "SALES_PRODUCT_NOT_FOUND");
  const variants = (await client.query(
    `SELECT id, code, name, variant_attributes FROM tenant.items WHERE organization_id = $1 AND parent_item_id = $2 AND status = 'active' AND is_sellable ORDER BY code`,
    [context.organizationId, template.id])).rows;
  const names = [];
  for (const variant of variants) for (const name of Object.keys(variant.variant_attributes ?? {})) if (!names.includes(name)) names.push(name);
  const [rowAttribute = null, columnAttribute = null] = names;
  const valueOf = (variant, name) => (name ? String(variant.variant_attributes?.[name] ?? "—") : "");
  const rows = [];
  const columns = [];
  const cells = {};
  for (const variant of variants) {
    const row = valueOf(variant, rowAttribute) || variant.name;
    const column = valueOf(variant, columnAttribute);
    if (!rows.includes(row)) rows.push(row);
    if (!columns.includes(column)) columns.push(column);
    cells[`${row}|${column}`] ??= { itemId: variant.id, code: variant.code, name: variant.name };
  }
  return { template, rowAttribute, columnAttribute, rows, columns, cells };
}
