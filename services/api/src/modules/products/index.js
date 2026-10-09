// The Item Master: the one catalogue (Products and Services) Sales, CRM, Procurement, Inventory, Manufacturing and POS share. An item is
// a tenant.items row; each module owns its own behaviour on that one identity (prices in price lists, stock in Inventory, tax in the tax
// engine). Routes import from here; each operation takes (client, context, …) and runs inside the caller's transaction.
export * from "./constants.js";
export { canViewProductCost, canViewProductStock, productCan, productCapabilities, requireProductPermission } from "./access.js";
export {
  activateProduct, activationIssues, buildProductListWhere, createProduct, deactivateProduct, deleteProduct, getProduct, listProducts, previewReclassification, productUses,
  reclassifyItem, updateProduct, validateItemForActivation,
} from "./records.js";
export { findDuplicateProducts } from "./duplicates.js";
export { addItemIdentifier, findItemByIdentifier, listItemIdentifiers, removeItemIdentifier, setPrimaryBarcode } from "./identifiers.js";
export {
  addItemUomConversion, getItemUnits, getItemUomHistory, listItemUomConversions, removeItemUomConversion, setItemDefaultUoms, updateItemUomConversion, validateUomConversion,
} from "./conversions.js";
export {
  UOM_PURPOSES, allowedItemUnits, baseUnitPrice, convertBaseToUom, convertBetweenUnits, exactConversion, getAllowedInventoryUoms, getAllowedPurchaseUoms, getAllowedSalesUoms,
  itemUnits, normalizeQuantityToBase, normalizeUnitPriceToBase, resolveItemUnit, standardUnitFactor, toBaseQuantity, unitRatio, validateUomDimension,
  UOM_ERROR_CODES, amountsEquivalent, convertBetweenUoms, convertFromBase, convertQuantity, convertUnitPrice, describeInPackages, getConversionSnapshot, normalizeToBase,
  normalizeUnitPrice, resolveItemConversion, validateQuantityPrecision, validateSerialConversion,
} from "./uom.js";
export { UOM_CONVERSION_COLUMNS, buildUomConversionTemplate, exportItemUomConversions, importItemUomConversions } from "./uom-import-export.js";
export { createItemVariant, getItemVariants } from "./variants.js";
export {
  CATEGORY_REPORTS, createItemCategory, deleteItemCategory, deleteUnusedItemCategory, getCategoryActivity, getCategoryBreadcrumb, getCategoryInventoryValue, getCategoryItems,
  getCategoryReport, getCategoryStockSummary, getItemCategory, getItemCategoryAncestors, getItemCategoryDescendants, getItemCategoryTree, listItemCategories, moveItemCategory,
  reassignCategoryItems, resolveCategoryDefaults, setItemCategoryStatus, updateItemCategory, validateItemCategoryAssignment,
} from "./categories.js";
export { UOM_CATEGORIES, createUnitOfMeasure, listUnitsOfMeasure, setUnitOfMeasureStatus, updateUnitOfMeasure } from "./units.js";
export {
  PRODUCT_RELATED_LISTS, getItemAuditHistory, getItemBatches, getItemInventoryMovements, getItemInventorySummary, getItemLastPurchasePrice, getItemSerials,
  getItemWarehouseBalances, getProductDetails, getProductHistory, listProductTransactions,
} from "./summary.js";
export { listProductFiles, prepareProductFileUpload, readProductFile, removeProductFile, setProductImage, uploadProductFile } from "./files.js";
export { getProductOptions } from "./options.js";
export {
  SKU_MAX_LENGTH, SKU_MODES, bulkValidateSkus, changeItemSku, checkSkuAvailability, findItemByPreviousSku, findItemBySku, generateItemSku, getSkuHistory, getSkuSettings, normalizeSku,
  previewNextSku, skuProblem, updateSkuSettings, validateSku,
} from "./sku.js";
export { PRODUCT_IMPORT_FIELDS, analyzeProductImport, buildProductImportErrorFile, buildProductImportTemplate, exportProducts, importProducts } from "./import-export.js";
