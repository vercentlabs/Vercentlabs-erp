// Everything the item screens need to draw their forms and filters.
import { canViewProductCost, canViewProductStock, productCapabilities, requireProductPermission } from "./access.js";
import { IDENTIFIER_TYPES, LIFECYCLE_LABELS, PRODUCT_PERMISSIONS, PRODUCT_TYPES, PRODUCT_VIEWS, TRACKING_MODES, VALUATION_METHODS } from "./constants.js";
import { CATEGORY_REPORTS, listItemCategories } from "./categories.js";
import { previewNextSku, SKU_MODES } from "./sku.js";
import { UOM_CATEGORIES } from "./units.js";

export async function getProductOptions(client, context) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.view, "You do not have permission to view items.");
  const rows = async (sql) => (await client.query(sql, [context.organizationId])).rows;
  const categories = await listItemCategories(client, context, { includeInactive: false });
  const uoms = await rows(`SELECT id, code, name, category, decimal_places FROM tenant.units_of_measure WHERE organization_id = $1 AND status = 'active' ORDER BY category, name`);
  const taxCategories = await rows(
    `SELECT tax.id, tax.code, tax.name, tax.treatment, tax.applies_to, rate.rate AS gst_rate, NULLIF(rate.cess_rate, 0) AS cess_rate
       FROM tenant.tax_categories tax
       LEFT JOIN LATERAL (
         SELECT r.rate, r.cess_rate FROM tenant.tax_rates r WHERE r.organization_id = tax.organization_id AND r.tax_category_id = tax.id AND r.status = 'active'
            AND r.effective_from <= current_date AND (r.effective_to IS NULL OR r.effective_to >= current_date) ORDER BY r.effective_from DESC LIMIT 1) rate ON true
      WHERE tax.organization_id = $1 AND tax.status = 'active' ORDER BY rate.rate NULLS LAST, tax.name`);
  // Finance's item profiles, offered to items and categories.
  const profiles = await rows(`SELECT id, profile_kind, code, name FROM tenant.accounting_item_profiles WHERE organization_id = $1 AND status = 'active' ORDER BY profile_kind, lower(name)`);
  // How SKUs are given here, with the SKU a new item without a category would get.
  const sku = await previewNextSku(client, context, {});
  const brands = await rows(`SELECT DISTINCT brand FROM tenant.items WHERE organization_id = $1 AND brand IS NOT NULL AND brand <> '' ORDER BY brand LIMIT 500`);
  return {
    types: PRODUCT_TYPES,
    views: PRODUCT_VIEWS,
    lifecycle: Object.entries(LIFECYCLE_LABELS).map(([code, label]) => ({ code, label })),
    trackingModes: TRACKING_MODES,
    valuationMethods: VALUATION_METHODS,
    identifierTypes: IDENTIFIER_TYPES,
    uomCategories: UOM_CATEGORIES,
    categories: categories.map((row) => ({
      id: row.id, name: row.path, label: row.name, code: row.code, depth: row.depth, parentId: row.parentId, effectiveItemTypes: row.effectiveItemTypes, skuPrefix: row.skuPrefix,
      defaultValuationMethod: row.defaultValuationMethod, defaultTaxCategoryId: row.defaultTaxCategoryId, defaultHsnSacCode: row.defaultHsnSacCode,
    })),
    uoms: uoms.map((row) => ({ id: row.id, code: row.code, name: row.name, category: row.category, decimalPlaces: Number(row.decimal_places) })),
    taxCategories: taxCategories.map((row) => ({
      id: row.id, code: row.code, name: row.name, treatment: row.treatment, appliesTo: row.applies_to, gstRate: row.gst_rate === null ? null : Number(row.gst_rate), cessRate: row.cess_rate === null ? null : Number(row.cess_rate),
    })),
    brands: brands.map((row) => row.brand),
    inventoryProfiles: profiles.filter((row) => row.profile_kind === "inventory").map((row) => ({ id: row.id, code: row.code, name: `${row.code} · ${row.name}` })),
    accountingProfiles: profiles.filter((row) => row.profile_kind === "accounting").map((row) => ({ id: row.id, code: row.code, name: `${row.code} · ${row.name}` })),
    categoryReports: CATEGORY_REPORTS,
    sku: { mode: sku.mode, modes: SKU_MODES, example: sku.sku },
    showsCost: canViewProductCost(context),
    showsStock: canViewProductStock(context),
    capabilities: productCapabilities(context),
  };
}
