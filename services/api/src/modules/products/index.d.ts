/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };
type Input = Record<string, any>;
type Prepared = { bytes: Buffer; mimeType: string; fileName: string; contentSha256: string };

export class ProductError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(status: number, message: string, code?: string, details?: Record<string, unknown>);
}
export const PRODUCT_PERMISSIONS: Readonly<Record<
  "view" | "create" | "edit" | "activate" | "delete" | "import" | "export" | "editTax" | "editInventory" | "manageCategories" | "manageUnits" | "manageIdentifiers"
  | "configureTracking" | "configureAccounting" | "viewStock" | "viewCost" | "editCost" | "generateSku" | "enterSku" | "changeSku" | "viewSkuHistory" | "configureSkuNumbering" | "manageUomMaster" | "changeUomConversions" | "changeDefaultUoms" | "deleteCategories" | "reclassify" | "categoryInventoryDefaults"
  | "categoryAccountingDefaults" | "categoryTaxDefaults", string>>;
export const CATEGORY_REPORTS: ReadonlyArray<{ key: string; title: string; unit: string; dated: boolean }>;
export const UOM_CATEGORIES: ReadonlyArray<{ code: string; label: string }>;
export const PRODUCT_RELATED_LISTS: readonly string[];
export const PRODUCT_IMPORT_FIELDS: ReadonlyArray<{ key: string; label: string; aliases: string[]; sample: string }>;

export function productCan(context: Context, permission: string): boolean;
export function canViewProductCost(context: Context): boolean;
export function canViewProductStock(context: Context): boolean;
export function productCapabilities(context: Context): Record<string, boolean>;

export function getProductOptions(client: Client, context: Context): Promise<any>;
export function listProducts(client: Client, context: Context, filters?: Input): Promise<any>;
export function getProduct(client: Client, context: Context, productId: string): Promise<any>;
export function createProduct(client: Client, context: Context, input: Input, options?: { origin?: string }): Promise<any>;
export function validateItemForActivation(client: Client, context: Context, productId: string): Promise<{ ready: boolean; issues: Array<{ field: string; message: string }> }>;
export function activationIssues(product: Input): Array<{ field: string; message: string }>;

export function listItemIdentifiers(client: Client, context: Context, itemId: string, options?: { includeRemoved?: boolean }): Promise<any[]>;
export function addItemIdentifier(client: Client, context: Context, itemId: string, input: Input): Promise<any>;
export function removeItemIdentifier(client: Client, context: Context, itemId: string, identifierId: string): Promise<any>;
export function setPrimaryBarcode(client: Client, context: Context, itemId: string, identifierId: string): Promise<any>;
export function findItemByIdentifier(client: Client, context: Context, value: string): Promise<any>;
export function getItemUnits(client: Client, context: Context, itemId: string, options?: { includeInactive?: boolean }): Promise<any>;
export function getItemUomHistory(client: Client, context: Context, itemId: string): Promise<any[]>;
export function setItemDefaultUoms(client: Client, context: Context, itemId: string, input: Input): Promise<any>;
export const UOM_PURPOSES: ReadonlyArray<"purchase" | "sales" | "inventory">;
export function itemUnits(client: Client, organizationId: string, item: unknown, options?: { includeInactive?: boolean }): Promise<any[]>;
export function allowedItemUnits(client: Client, organizationId: string, item: unknown, purpose?: string | null): Promise<any[]>;
export function getAllowedPurchaseUoms(client: Client, organizationId: string, item: unknown): Promise<any[]>;
export function getAllowedSalesUoms(client: Client, organizationId: string, item: unknown): Promise<any[]>;
export function getAllowedInventoryUoms(client: Client, organizationId: string, item: unknown): Promise<any[]>;
export function resolveItemUnit(client: Client, organizationId: string, item: unknown, uomId: string | null, options?: { purpose?: string | null; allowInactive?: boolean }): Promise<any>;
export function normalizeQuantityToBase(client: Client, organizationId: string, item: unknown, uomId: string | null, quantity: unknown, options?: { purpose?: string | null; allowInactive?: boolean }): Promise<any>;
export function convertBaseToUom(client: Client, organizationId: string, item: unknown, uomId: string | null, baseQuantity: unknown): Promise<any>;
export function convertBetweenUnits(client: Client, organizationId: string, item: unknown, quantity: unknown, fromUomId: string | null, toUomId: string | null, options?: { purpose?: string | null }): Promise<any>;
export function normalizeUnitPriceToBase(client: Client, organizationId: string, item: unknown, uomId: string | null, unitPrice: unknown): Promise<bigint | null>;
export function unitRatio(client: Client, organizationId: string, item: unknown, fromUomId: string | null, toUomId: string | null, options?: { purpose?: string | null }): Promise<any>;
export const UOM_ERROR_CODES: Readonly<Record<string, string>>;
export function normalizeToBase(client: Client, organizationId: string, item: unknown, quantity: unknown, uomId: string | null, options?: { purpose?: string | null; allowInactive?: boolean }): Promise<any>;
export function getConversionSnapshot(client: Client, organizationId: string, item: unknown, quantity: unknown, uomId: string | null, options?: { purpose?: string | null; allowInactive?: boolean }): Promise<any>;
export function convertFromBase(client: Client, organizationId: string, item: unknown, baseQuantity: unknown, uomId: string | null): Promise<any>;
export function convertBetweenUoms(client: Client, organizationId: string, item: unknown, quantity: unknown, fromUomId: string | null, toUomId: string | null, options?: { exact?: boolean; purpose?: string | null }): Promise<any>;
export function convertQuantity(client: Client, organizationId: string, item: unknown, quantity: unknown, fromUomId: string | null, toUomId: string | null, options?: { exact?: boolean; purpose?: string | null }): Promise<any>;
export function normalizeUnitPrice(client: Client, organizationId: string, item: unknown, unitPrice: unknown, uomId: string | null): Promise<any>;
export function convertUnitPrice(client: Client, organizationId: string, item: unknown, unitPrice: unknown, fromUomId: string | null, toUomId: string | null): Promise<any>;
export function amountsEquivalent(leftQuantity: unknown, leftPrice: unknown, rightQuantity: unknown, rightPrice: unknown, places?: number): { equivalent: boolean; left: string; right: string; difference: string };
export function validateQuantityPrecision(client: Client, organizationId: string, item: unknown, quantity: unknown, uomId: string | null): Promise<any>;
export function validateSerialConversion(client: Client, organizationId: string, item: unknown, factor: unknown): Promise<any>;
export function resolveItemConversion(client: Client, organizationId: string, item: unknown, uomId: string | null, options?: { purpose?: string | null; allowInactive?: boolean }): Promise<any>;
export function describeInPackages(client: Client, organizationId: string, item: unknown, baseQuantity: unknown): Promise<{ text: string; approximately: string } | null>;
export const UOM_CONVERSION_COLUMNS: ReadonlyArray<{ key: string; label: string; aliases: string[] }>;
export function buildUomConversionTemplate(): string;
export function exportItemUomConversions(client: Client, context: Context, options?: { includeInactive?: boolean }): Promise<{ fileName: string; csv: string; count: number }>;
export function importItemUomConversions(client: Client, context: Context, input: { bytes: Buffer; fileName: string; dryRun?: boolean; acknowledgeHistory?: boolean }): Promise<any>;
export function standardUnitFactor(client: Client, organizationId: string, baseUomId: string, uomId: string): Promise<bigint | null>;
export function exactConversion(quantity: unknown, fromFactor: unknown, toFactor: unknown): bigint | null;
export function toBaseQuantity(quantity: unknown, factor: unknown): bigint;
export function baseUnitPrice(unitPrice: unknown, factor: unknown): bigint;
export function validateUomDimension(client: Client, unit: { code: string; category: string }, base: { code: string; category: string }): Promise<{ problem?: string; needsReason?: string }>;
export const SKU_MAX_LENGTH: number;
export const SKU_MODES: ReadonlyArray<{ code: string; label: string; description: string }>;
export function normalizeSku(value: unknown): string;
export function skuProblem(value: unknown): string | null;
export function validateSku(value: unknown, field?: string): string;
export function getSkuSettings(client: Client, context: Context): Promise<any>;
export function updateSkuSettings(client: Client, context: Context, input: Input): Promise<any>;
export function previewNextSku(client: Client, context: Context, options?: { categoryId?: string | null }): Promise<any>;
export function generateItemSku(client: Client, context: Context, options?: { categoryId?: string | null }): Promise<{ sku: string; reference: string }>;
export function checkSkuAvailability(client: Client, context: Context, value: unknown, options?: { exceptItemId?: string | null }): Promise<any>;
export function bulkValidateSkus(client: Client, context: Context, values: unknown[]): Promise<any[]>;
export function changeItemSku(client: Client, context: Context, itemId: string, input: Input): Promise<any>;
export function getSkuHistory(client: Client, context: Context, itemId: string): Promise<any[]>;
export function findItemBySku(client: Client, context: Context, value: unknown): Promise<any>;
export function findItemByPreviousSku(client: Client, context: Context, value: unknown): Promise<any>;

export function listItemUomConversions(client: Client, context: Context, itemId: string): Promise<any[]>;
export function addItemUomConversion(client: Client, context: Context, itemId: string, input: Input): Promise<any>;
export function updateItemUomConversion(client: Client, context: Context, itemId: string, conversionId: string, input: Input): Promise<any>;
export function removeItemUomConversion(client: Client, context: Context, itemId: string, conversionId: string, input?: Input): Promise<any>;
export function validateUomConversion(client: Client, context: Context, itemId: string, input: Input): Promise<any>;

export function createItemVariant(client: Client, context: Context, templateId: string, input: Input): Promise<any>;
export function getItemVariants(client: Client, context: Context, templateId: string): Promise<any>;

export function listItemCategories(client: Client, context: Context, filters?: Input): Promise<any[]>;
export function getItemCategory(client: Client, context: Context, categoryId: string): Promise<any>;
export function createItemCategory(client: Client, context: Context, input: Input): Promise<any>;
export function updateItemCategory(client: Client, context: Context, categoryId: string, input: Input): Promise<any>;
export function setItemCategoryStatus(client: Client, context: Context, categoryId: string, status: string, input?: Input): Promise<any>;
export function deleteItemCategory(client: Client, context: Context, categoryId: string, input?: Input): Promise<{ deleted: true }>;
export function deleteUnusedItemCategory(client: Client, context: Context, categoryId: string, input?: Input): Promise<{ deleted: true }>;
export function moveItemCategory(client: Client, context: Context, categoryId: string, input: Input): Promise<any>;
export function getItemCategoryTree(client: Client, context: Context, filters?: Input): Promise<any[]>;
export function getItemCategoryAncestors(client: Client, context: Context, categoryId: string): Promise<any[]>;
export function getItemCategoryDescendants(client: Client, context: Context, categoryId: string): Promise<any[]>;
export function getCategoryBreadcrumb(client: Client, context: Context, categoryId: string): Promise<any[]>;
export function resolveCategoryDefaults(client: Client, context: Context, categoryId: string): Promise<any>;
export function validateItemCategoryAssignment(client: Client, context: Context, categoryId: string, type: string, options?: { allowInactive?: boolean }): Promise<any>;
export function getCategoryItems(client: Client, context: Context, categoryId: string, options?: { includeDescendants?: boolean; limit?: number; offset?: number }): Promise<any>;
export function getCategoryStockSummary(client: Client, context: Context, categoryId: string, options?: { includeDescendants?: boolean }): Promise<any>;
export function getCategoryInventoryValue(client: Client, context: Context, categoryId: string): Promise<number | undefined>;
export function getCategoryActivity(client: Client, context: Context, categoryId: string): Promise<any[]>;
export function getCategoryReport(client: Client, context: Context, reportKey: string, filters?: Input): Promise<any>;
export function reclassifyItem(client: Client, context: Context, productId: string, input: Input): Promise<any>;
export function previewReclassification(client: Client, context: Context, productId: string, categoryId: string): Promise<any>;
export function reassignCategoryItems(client: Client, context: Context, categoryId: string, input: Input): Promise<any>;

export function listUnitsOfMeasure(client: Client, context: Context, options?: { includeInactive?: boolean }): Promise<any[]>;
export function createUnitOfMeasure(client: Client, context: Context, input: Input): Promise<any>;
export function updateUnitOfMeasure(client: Client, context: Context, uomId: string, input: Input): Promise<any>;
export function setUnitOfMeasureStatus(client: Client, context: Context, uomId: string, status: string): Promise<any>;
export function updateProduct(client: Client, context: Context, productId: string, input: Input): Promise<any>;
export function activateProduct(client: Client, context: Context, productId: string, input?: Input): Promise<any>;
export function deactivateProduct(client: Client, context: Context, productId: string, input?: Input): Promise<any>;
export function deleteProduct(client: Client, context: Context, productId: string): Promise<{ deleted: true }>;
export function productUses(client: Client, context: Context, productId: string, options?: { only?: string[] | null }): Promise<string[]>;
export function findDuplicateProducts(client: Client, context: Context, input: Input, options?: { excludeId?: string | null; limit?: number }): Promise<any>;

export function getProductDetails(client: Client, context: Context, productId: string): Promise<any>;
export function listProductTransactions(client: Client, context: Context, productId: string, list: string): Promise<any[]>;
export function getProductHistory(client: Client, context: Context, productId: string): Promise<any[]>;
export function getItemAuditHistory(client: Client, context: Context, productId: string): Promise<any[]>;
export function getItemInventorySummary(client: Client, context: Context, itemId: string): Promise<any>;
export function getItemWarehouseBalances(client: Client, context: Context, itemId: string): Promise<any[]>;
export function getItemInventoryMovements(client: Client, context: Context, itemId: string, options?: { limit?: number }): Promise<any[]>;
export function getItemBatches(client: Client, context: Context, itemId: string): Promise<any[]>;
export function getItemSerials(client: Client, context: Context, itemId: string): Promise<any[]>;
export function getItemLastPurchasePrice(client: Client, context: Context, itemId: string): Promise<any>;

export function prepareProductFileUpload(input: { fileName: string; bytes: Buffer }, env?: Record<string, string | undefined>): Promise<Prepared>;
export function listProductFiles(client: Client, context: Context, productId: string): Promise<any[]>;
export function uploadProductFile(client: Client, context: Context, productId: string, input: { prepared: Prepared; makePrimaryImage?: boolean }): Promise<any>;
export function setProductImage(client: Client, context: Context, productId: string, fileId: string | null): Promise<{ imageAttachmentId: string | null }>;
export function removeProductFile(client: Client, context: Context, productId: string, fileId: string): Promise<{ removed: true }>;
export function readProductFile(client: Client, context: Context, productId: string, fileId: string): Promise<{ fileName: string; mimeType: string; body: Buffer }>;

export function analyzeProductImport(client: Client, context: Context, input: { bytes: Uint8Array | Buffer; fileName: string }): Promise<any>;
export function importProducts(client: Client, context: Context, input: { bytes: Uint8Array | Buffer; fileName: string; mapping?: Record<string, string>; existing?: string; dryRun?: boolean }): Promise<any>;
export function buildProductImportTemplate(): string;
export function buildProductImportErrorFile(results: any[]): string;
export function exportProducts(client: Client, context: Context, filters?: Input): Promise<{ fileName: string; csv: string; count: number }>;
