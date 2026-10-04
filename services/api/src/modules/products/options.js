// Everything the product screens need to draw their forms and filters.
import { canViewProductCost, productCapabilities, requireProductPermission } from "./access.js";
import { PRODUCT_PERMISSIONS, PRODUCT_TYPES, PRODUCT_VIEWS } from "./constants.js";

export async function getProductOptions(client, context) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.view, "You do not have permission to view products.");
  const rows = async (sql) => (await client.query(sql, [context.organizationId])).rows;
  const categories = await rows(
    `SELECT category.id, category.name, parent.name AS parent_name FROM tenant.item_groups category
       LEFT JOIN tenant.item_groups parent ON parent.organization_id = category.organization_id AND parent.id = category.parent_id
      WHERE category.organization_id = $1 AND category.status = 'active' ORDER BY lower(COALESCE(parent.name, category.name)), category.parent_id NULLS FIRST, lower(category.name)`);
  const uoms = await rows(`SELECT id, code, name, category FROM tenant.units_of_measure WHERE organization_id = $1 AND status = 'active' ORDER BY category, name`);
  const taxCategories = await rows(
    `SELECT tax.id, tax.code, tax.name,
            (SELECT rate FROM tenant.tax_rates r WHERE r.organization_id = tax.organization_id AND r.tax_category_id = tax.id AND r.status = 'active' AND r.tax_type IN ('gst', 'igst')
                AND (r.effective_from IS NULL OR r.effective_from <= current_date) AND (r.effective_to IS NULL OR r.effective_to >= current_date)
              ORDER BY r.tax_type = 'gst' DESC LIMIT 1) AS gst_rate,
            (SELECT rate FROM tenant.tax_rates r WHERE r.organization_id = tax.organization_id AND r.tax_category_id = tax.id AND r.status = 'active' AND r.tax_type = 'cess' LIMIT 1) AS cess_rate
       FROM tenant.tax_categories tax WHERE tax.organization_id = $1 AND tax.status = 'active' ORDER BY tax.name`);
  return {
    types: PRODUCT_TYPES,
    views: PRODUCT_VIEWS,
    categories: categories.map((row) => ({ id: row.id, name: row.parent_name ? `${row.parent_name} › ${row.name}` : row.name })),
    uoms: uoms.map((row) => ({ id: row.id, code: row.code, name: row.name, category: row.category })),
    taxCategories: taxCategories.map((row) => ({
      id: row.id, code: row.code, name: row.name, gstRate: row.gst_rate === null ? null : Number(row.gst_rate), cessRate: row.cess_rate === null ? null : Number(row.cess_rate),
    })),
    showsCost: canViewProductCost(context),
    capabilities: productCapabilities(context),
  };
}
