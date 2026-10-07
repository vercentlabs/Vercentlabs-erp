// Variants: a template item (T-Shirt) groups explicit variant items (Black / Small, Black / Medium, …). Each variant is an ordinary item
// with its own SKU, barcodes, stock, batch / serial setting and transactions; the template is never stocked, bought or sold, so stock is
// never counted twice. Variants are created one by one as they are needed — there is no combination generator.
import { canViewProductStock, requireProductPermission } from "./access.js";
import { PRODUCT_PERMISSIONS, ProductError } from "./constants.js";
import { createProduct, listProducts, loadProductRow, toProduct } from "./records.js";
import { has, text } from "./validation.js";

const attributeKey = (attributes) => JSON.stringify(Object.entries(attributes ?? {}).map(([name, value]) => [name.toLowerCase(), String(value).toLowerCase()]).sort());

// input: { attributes: { Size: "Large", Colour: "Black" } (required), code (the SKU; generated when empty), name (defaults to the template
// name with the attribute values), barcode, type ("stock" default | "non_stock"), trackingType, requiresExpiryDate, shelfLifeDays,
// isSellable, isPurchasable, status }. Everything else — category, units and conversions, tax, brand, valuation — comes from the template.
export async function createItemVariant(client, context, templateId, input = {}) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.create, "You do not have permission to create items.");
  const templateRow = await loadProductRow(client, context, templateId, { lock: true });
  const template = toProduct(templateRow, { cost: true });
  if (!template.isVariantTemplate) throw new ProductError(409, `${template.name} is not a variant template.`, "PRODUCT_NOT_TEMPLATE");
  if (template.lifecycleStatus === "inactive") throw new ProductError(409, "The template is inactive.", "PRODUCT_TEMPLATE_INACTIVE");
  const attributes = Object.fromEntries(Object.entries(input.attributes ?? {}).map(([name, value]) => [text(name), text(value)]).filter(([name, value]) => name && value));
  if (!Object.keys(attributes).length) throw new ProductError(400, "Give the variant's attributes, such as Size: Large.", "PRODUCT_VALIDATION", { issues: [{ field: "attributes", message: "Give the variant's attributes, such as Size: Large." }] });
  const siblings = (await client.query(`SELECT code, variant_attributes FROM tenant.items WHERE organization_id = $1 AND parent_item_id = $2`, [context.organizationId, template.id])).rows;
  const clash = siblings.find((row) => attributeKey(row.variant_attributes) === attributeKey(attributes));
  if (clash) throw new ProductError(409, `Variant ${clash.code} already has these attributes.`, "PRODUCT_VARIANT_EXISTS", { issues: [{ field: "attributes", message: `Variant ${clash.code} already has these attributes.` }] });
  const conversions = (await client.query(
    `SELECT from_uom_id, conversion_factor FROM tenant.item_uom_conversions WHERE organization_id = $1 AND item_id = $2 AND to_uom_id = $3 AND status = 'active'`,
    [context.organizationId, template.id, template.baseUomId])).rows;
  const factorOf = (uomId) => conversions.find((row) => row.from_uom_id === uomId)?.conversion_factor ?? null;
  const pick = (field, fallback) => (has(input, field) ? input[field] : fallback);
  const variant = await createProduct(client, context, {
    code: input.code ?? null,
    name: text(input.name) || `${template.name} — ${Object.values(attributes).join(" / ")}`,
    type: pick("type", "stock") === "non_stock" ? "non_stock" : "stock",
    categoryId: template.categoryId, description: template.description, salesDescription: template.salesDescription, purchaseDescription: template.purchaseDescription,
    brand: template.brand, manufacturerName: template.manufacturerName, manufacturerPartNumber: pick("manufacturerPartNumber", null),
    baseUomId: template.baseUomId, salesUomId: template.salesUomId, purchaseUomId: template.purchaseUomId,
    salesUomFactor: template.salesUomId !== template.baseUomId ? factorOf(template.salesUomId) : null,
    purchaseUomFactor: template.purchaseUomId !== template.baseUomId ? factorOf(template.purchaseUomId) : null,
    hsnSacCode: template.hsnSacCode, taxCategoryId: template.taxCategoryId, valuationMethod: template.valuationMethod,
    inventoryProfileId: template.inventoryProfileId, accountingProfileId: template.accountingProfileId,
    trackingType: pick("trackingType", "none"), requiresExpiryDate: pick("requiresExpiryDate", false), shelfLifeDays: pick("shelfLifeDays", null),
    isSellable: pick("isSellable", true), isPurchasable: pick("isPurchasable", true),
    variantAttributes: attributes, barcode: input.barcode ?? null, status: input.status ?? (template.lifecycleStatus === "active" ? "active" : "draft"),
  }, { parent: { id: template.id, code: template.code } });
  return variant;
}

// The template's variants, with their stock for callers who may see it.
export async function getItemVariants(client, context, templateId) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.view, "You do not have permission to view items.");
  const template = toProduct(await loadProductRow(client, context, templateId));
  const list = await listProducts(client, context, { parentItemId: template.id, limit: 200, sort: "code" });
  const showsStock = canViewProductStock(context);
  const total = (field) => list.products.reduce((sum, variant) => sum + Number(variant[field] ?? 0), 0);
  return {
    template: { id: template.id, code: template.code, name: template.name, isVariantTemplate: template.isVariantTemplate }, variants: list.products, showsStock,
    // Read from the variants' own stock; the template is never stocked itself.
    ...(showsStock ? { totals: { onHand: total("onHand"), available: total("available") } } : {}),
  };
}
