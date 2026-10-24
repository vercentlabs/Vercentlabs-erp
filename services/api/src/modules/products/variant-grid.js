// The variant grid (Sales report Phase 3; Procurement report Phase 3): a product made in sizes and colours is entered as one grid —
// sizes down, colours across — and each filled cell becomes a line for that variant. A template's variants are laid out by their first
// two attributes (one attribute: a single column). Only active variants that are sold (purpose "sell") or bought ("buy") appear; a missing
// combination is an empty cell. The apps check their own permissions before calling.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const flag = (purpose) => (purpose === "buy" ? "is_purchasable" : "is_sellable");

// Templates with at least one variant for the purpose, by name or code.
export async function variantTemplates(client, organizationId, { search = "", purpose = "sell" } = {}) {
  const term = String(search ?? "").trim().slice(0, 100);
  const rows = (await client.query(
    `SELECT template.id, template.code, template.name, count(variant.id)::int AS variants
       FROM tenant.items template
       JOIN tenant.items variant ON variant.organization_id = template.organization_id AND variant.parent_item_id = template.id AND variant.status = 'active' AND variant.${flag(purpose)}
      WHERE template.organization_id = $1 AND template.is_variant_template AND template.status = 'active'
        AND ($2 = '' OR template.name ILIKE '%' || $2 || '%' OR template.code ILIKE '%' || $2 || '%')
      GROUP BY template.id ORDER BY template.name LIMIT 30`, [organizationId, term])).rows;
  return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, variants: row.variants }));
}

// { template, rowAttribute, columnAttribute, rows: [value], columns: [value], cells: { "row|column": { itemId, code, name } } }, or null.
export async function variantGridOf(client, organizationId, templateId, { purpose = "sell" } = {}) {
  if (!UUID.test(String(templateId ?? ""))) return null;
  const template = (await client.query("SELECT id, code, name FROM tenant.items WHERE organization_id = $1 AND id = $2 AND is_variant_template", [organizationId, templateId])).rows[0];
  if (!template) return null;
  const variants = (await client.query(
    `SELECT id, code, name, variant_attributes FROM tenant.items WHERE organization_id = $1 AND parent_item_id = $2 AND status = 'active' AND ${flag(purpose)} ORDER BY code`,
    [organizationId, template.id])).rows;
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
