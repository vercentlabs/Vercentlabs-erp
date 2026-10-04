// Products and Services: the one catalogue Sales, CRM, Procurement,
// Inventory, Manufacturing and POS share. A product is a tenant.items row;
// each module owns its own behaviour (prices in price lists, stock in
// Inventory, tax in the tax engine) on that one identity. Routes import from
// here; each operation takes (client, context, …) and runs inside the
// caller's transaction.
export * from "./constants.js";
export { canViewProductCost, productCan, productCapabilities, requireProductPermission } from "./access.js";
export {
  activateProduct, buildProductListWhere, createProduct, deactivateProduct, deleteProduct, getProduct, listProducts, productUses, updateProduct,
} from "./records.js";
export { findDuplicateProducts } from "./duplicates.js";
export { PRODUCT_RELATED_LISTS, getProductDetails, getProductHistory, listProductTransactions } from "./summary.js";
export { listProductFiles, prepareProductFileUpload, readProductFile, removeProductFile, setProductImage, uploadProductFile } from "./files.js";
export { getProductOptions } from "./options.js";
export { PRODUCT_IMPORT_FIELDS, analyzeProductImport, buildProductImportErrorFile, buildProductImportTemplate, exportProducts, importProducts } from "./import-export.js";
