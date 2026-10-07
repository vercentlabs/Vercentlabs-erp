"use client";

// Browser client for the Item Master (the shared product and service catalogue) under /api/products.
import { SalesApiError } from "@/features/sales/shared/http";

export type ItemType = "stock" | "non_stock" | "service";
export type Lifecycle = "draft" | "active" | "inactive";
export type TrackingMode = "none" | "batch" | "serial";
export type ItemCapabilities = Record<
  "view" | "create" | "edit" | "activate" | "delete" | "import" | "export" | "editTax" | "editInventory" | "manageCategories" | "manageUnits" | "manageIdentifiers"
  | "configureTracking" | "configureAccounting" | "viewStock" | "viewCost" | "editCost" | "generateSku" | "enterSku" | "changeSku" | "viewSkuHistory" | "configureSkuNumbering" | "manageUomMaster" | "changeUomConversions" | "changeDefaultUoms" | "deleteCategories" | "reclassify" | "categoryInventoryDefaults"
  | "categoryAccountingDefaults" | "categoryTaxDefaults", boolean>;
type Unit = { code: string; name: string; decimalPlaces?: number | null } | null;

export type Item = {
  id: string;
  code: string;
  sku: string;
  skuGenerationMode: "manual" | "automatic";
  skuChangedAt: string | null;
  previousSkus: string[];
  /** On a search result: why it matched (sku, barcode, sku_prefix, name, part_number, previous_sku, category). */
  matchedBy?: string;
  matchedPreviousSku?: string | null;
  name: string;
  type: ItemType;
  typeLabel: string;
  isService: boolean;
  lifecycleStatus: Lifecycle;
  lifecycleLabel: string;
  status: "active" | "inactive";
  isActive: boolean;
  isDraft: boolean;
  categoryId: string | null;
  categoryName: string | null;
  categoryBreadcrumb: Array<{ id: string; name: string }>;
  inventoryProfileId: string | null;
  inventoryProfileName: string | null;
  accountingProfileId: string | null;
  accountingProfileName: string | null;
  description: string | null;
  salesDescription: string | null;
  purchaseDescription: string | null;
  brand: string | null;
  manufacturerName: string | null;
  manufacturerPartNumber: string | null;
  barcode: string | null;
  baseUomId: string;
  baseUom: Unit;
  salesUomId: string;
  salesUom: Unit;
  salesUomFactor: number | null;
  purchaseUomId: string;
  purchaseUom: Unit;
  purchaseUomFactor: number | null;
  isSellable: boolean;
  isPurchasable: boolean;
  inventoryTracked: boolean;
  trackingType: TrackingMode;
  trackingLabel: string;
  requiresExpiryDate: boolean;
  shelfLifeDays: number | null;
  allowNegativeStock: boolean;
  valuationMethod: "moving_average" | "fifo" | "standard";
  valuationLabel: string;
  hsnSacCode: string | null;
  hsnSacLabel: "HSN" | "SAC";
  taxCategoryId: string | null;
  taxCategoryName: string | null;
  gstRate: number | null;
  cessRate: number | null;
  netWeight: number | null;
  grossWeight: number | null;
  weightUomId: string | null;
  weightUom: string | null;
  length: number | null;
  width: number | null;
  height: number | null;
  dimensionUomId: string | null;
  dimensionUom: string | null;
  volume: number | null;
  parentItemId: string | null;
  parent: { id: string; code: string; name: string } | null;
  isVariantTemplate: boolean;
  variantAttributes: Record<string, string>;
  variantCount: number;
  imageAttachmentId: string | null;
  version: number;
  standardCost?: number;
  onHand?: number;
  available?: number;
  createdByName: string | null;
  createdAt: string;
  updatedByName: string | null;
  updatedAt: string;
  activatedAt: string | null;
  capabilities?: ItemCapabilities;
};

export type ItemInput = Partial<{
  type: ItemType; code: string; name: string; categoryId: string | null; description: string | null; salesDescription: string | null; purchaseDescription: string | null;
  brand: string | null; manufacturerName: string | null; manufacturerPartNumber: string | null; baseUomId: string; salesUomId: string | null; salesUomFactor: number | null;
  purchaseUomId: string | null; purchaseUomFactor: number | null; isSellable: boolean; isPurchasable: boolean; hsnSacCode: string | null; taxCategoryId: string | null;
  standardCost: number | null; inventoryProfileId: string | null; accountingProfileId: string | null; trackingType: string; allowNegativeStock: boolean; requiresExpiryDate: boolean; shelfLifeDays: number | null; valuationMethod: string;
  netWeight: number | null; grossWeight: number | null; weightUomId: string | null; length: number | null; width: number | null; height: number | null; dimensionUomId: string | null;
  barcode: string | null; alternateBarcodes: string[]; isVariantTemplate: boolean; variantAttributes: Record<string, string>; status: Lifecycle; expectedVersion: number;
}>;

export type CategoryOption = {
  id: string; name: string; label: string; code: string; depth: number; parentId: string | null; effectiveItemTypes: ItemType[]; skuPrefix: string | null;
  defaultValuationMethod: string | null; defaultTaxCategoryId: string | null; defaultHsnSacCode: string | null;
};
export type ProfileOption = { id: string; code: string; name: string };
export type CategoryReportInfo = { key: string; title: string; unit: "count" | "quantity" | "money"; dated: boolean };
export type UomOption = { id: string; code: string; name: string; category: string; decimalPlaces: number };
export type ItemOptions = {
  types: Array<{ code: ItemType; label: string; goods: boolean }>;
  views: Array<{ key: string; label: string }>;
  lifecycle: Array<{ code: Lifecycle; label: string }>;
  trackingModes: Array<{ code: TrackingMode; label: string }>;
  valuationMethods: Array<{ code: string; label: string }>;
  identifierTypes: Array<{ code: string; label: string }>;
  uomCategories: Array<{ code: string; label: string }>;
  categories: CategoryOption[];
  uoms: UomOption[];
  taxCategories: Array<{ id: string; code: string; name: string; appliesTo: string; gstRate: number | null; cessRate: number | null }>;
  brands: string[];
  inventoryProfiles: ProfileOption[];
  accountingProfiles: ProfileOption[];
  categoryReports: CategoryReportInfo[];
  sku: { mode: SkuMode; modes: Array<{ code: SkuMode; label: string; description: string }>; example: string };
  showsCost: boolean;
  showsStock: boolean;
  capabilities: ItemCapabilities;
};

export type ItemFilters = Partial<Record<
  "view" | "search" | "type" | "categoryId" | "includeSubcategories" | "status" | "sellable" | "purchasable" | "inventoryTracked" | "trackingType" | "brand" | "hsnSac" | "taxCategoryId" | "parentItemId" | "sort" | "direction",
  string>> & { limit?: number; offset?: number };
export type ItemList = { products: Item[]; total: number; views: Array<{ key: string; label: string }>; showsCost: boolean; showsStock: boolean; capabilities: ItemCapabilities };

export type DuplicateMatch = { id: string; code: string; name: string; type: ItemType; status: string; strength: "strong" | "possible"; reasons: Array<{ signal: string; label: string }>; href: string };
export type Identifier = { id: string; type: string; typeLabel: string; value: string; uomId: string | null; uom: string | null; isPrimary: boolean; createdAt: string; createdByName: string | null };
export type Conversion = { id: string; uomId: string; uom: string; uomName: string; factor: string; baseUomId: string; baseUom: string; isSalesDefault: boolean; isPurchaseDefault: boolean; text: string };
export type WarehouseStock = { warehouseId: string; code: string | null; name: string; onHand: number; reserved: number; available: number; incoming: number; outgoing: number; averageCost?: number | null; value?: number };
export type InventorySummary = {
  tracked: boolean; uom: string | null; warehouses: WarehouseStock[];
  totals: { onHand: number; reserved: number; available: number; incoming: number; outgoing: number; value?: number } | null;
};
export type AccountRow = { key: string; label: string; code: string | null; name: string | null };
export type ItemDetails = {
  product: Item;
  access: { sales: boolean; procurement: boolean; inventory: boolean; stock: boolean; cost: boolean; accounting: boolean };
  sales: { sellable: boolean; uom: string | null; priceLists: Array<{ id: string; name: string; currencyCode: string | null; taxInclusive: boolean; rate: number; minimumQuantity: number; uom: string | null; validFrom: string | null; validTo: string | null }> };
  purchasing: { purchasable: boolean; uom: string | null; lastPurchase?: { unitPrice: number; perBaseUnit: number; currencyCode: string | null; date: string; purchaseOrderId: string; purchaseOrderNumber: string } | null };
  identifiers: Identifier[];
  conversions: Conversion[];
  accounting: { valuationMethod: string; valuationLabel: string; categoryName: string | null; inventoryProfileName: string | null; accountingProfileName: string | null; accounts: AccountRow[] };
  inventory?: InventorySummary;
};
export type Batch = { id: string; batchNumber: string; manufacturedOn: string | null; expiresOn: string | null; status: string; onHand: number; expired: boolean };
export type Serial = { id: string; serialNumber: string; status: string; warehouse: string | null; batch: string | null };
export type Movement = { id: string; number: string; type: string; quantity: number; uom: string | null; warehouse: string | null; batch: string | null; serial: string | null; reference: string | null; occurredAt: string; unitCost?: number };
export type TransactionRow = { id: string; code: string; party: string | null; status: string | null; quantity: number | null; uom: string | null; amount: number | null; currencyCode: string | null; date: string; href: string | null };
export type HistoryEntry = { id: string; eventType: string; summary: string; changes: Record<string, unknown>; createdAt: string; actorName: string | null };
export type ItemFile = { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string; isImage: boolean; isPrimaryImage: boolean };
export type DefaultField = "valuationMethod" | "inventoryProfileId" | "accountingProfileId" | "taxCategoryId" | "hsnSacCode";
export type ResolvedDefault = { value: string | null; source: "category" | "parent" | "company" | null; fromId: string | null; fromName: string | null; label?: string | null };
export type CategoryActivity = { id: string; eventType: string; kind: string; summary: string; changes: Record<string, unknown>; createdAt: string; actorName: string | null };
export type Category = {
  id: string; code: string; name: string; parentId: string | null; parentName: string | null; description: string | null; status: "active" | "inactive"; isActive: boolean;
  path: string; depth: number; breadcrumb: Array<{ id: string; code: string; name: string }>; sortOrder: number; iconAttachmentId: string | null; skuPrefix: string | null;
  allowedItemTypes: ItemType[] | null; effectiveItemTypes: ItemType[]; allowedItemTypesLabel: string;
  defaultValuationMethod: string | null; defaultValuationLabel: string | null; defaultInventoryProfileId: string | null; defaultInventoryProfileName: string | null;
  defaultAccountingProfileId: string | null; defaultAccountingProfileName: string | null; defaultTaxCategoryId: string | null; defaultTaxCategoryName: string | null; defaultHsnSacCode: string | null;
  childCount: number; descendantCount: number; directItems: number; directActiveItems: number; totalItems: number; totalActiveItems: number; version: number;
  createdAt: string; updatedAt: string;
  resolvedDefaults?: Record<DefaultField, ResolvedDefault>; children?: Category[]; history?: CategoryActivity[];
};
export type CategoryInput = Partial<{
  code: string; name: string; parentId: string | null; description: string | null; sortOrder: number; allowedItemTypes: ItemType[] | null; skuPrefix: string | null;
  defaultValuationMethod: string | null; defaultInventoryProfileId: string | null; defaultAccountingProfileId: string | null; defaultTaxCategoryId: string | null; defaultHsnSacCode: string | null;
  expectedVersion: number;
}>;
export type CategoryFilters = Partial<Record<"search" | "status" | "parentId" | "hasItems" | "hasChildren" | "profileId", string>>;
export type CategoryStock = {
  includeDescendants: boolean;
  warehouses: Array<{ warehouseId: string; name: string; onHand: number; reserved: number; available: number; value?: number }>;
  totals: { onHand: number; reserved: number; available: number; value?: number };
};
export type CategoryReport = {
  key: string; title: string; unit: "count" | "quantity" | "money"; uncategorized: number; grandTotal: number;
  rows: Array<{ categoryId: string; code: string; name: string; path: string; depth: number; isActive: boolean; direct: number; total: number; directOut?: number; totalOut?: number }>;
};
export type SkuMode = "manual" | "automatic" | "either";
export type SkuSettings = {
  mode: SkuMode; modeLabel: string; defaultPrefix: string; separator: string; padding: number; includeYear: boolean; useCategoryPrefix: boolean; allowSkuChanges: boolean;
  previousSkuSearch: boolean; skuReuse: boolean; version: number; updatedAt: string | null; example: string;
  modes: Array<{ code: SkuMode; label: string; description: string }>; separators: string[];
};
export type SkuPreview = { mode: SkuMode; sku: string; prefix: string; prefixSource: "category" | "default"; prefixFrom: string | null; generated: boolean };
export type SkuCheck = { sku: string; valid: boolean; problem: string | null; available: boolean; reason: "in_use" | "previous" | null; holder: { id: string; code: string; name: string } | null };
export type SkuHistoryEntry = { id: string; oldSku: string; newSku: string; reason: string | null; changedAt: string; changedByName: string | null };
export type ReclassifyDifference = { field: DefaultField; label: string; current: string | null; suggested: string; source: string; fromName: string | null };
export type UnitOfMeasure = {
  id: string; code: string; name: string; symbol: string | null; category: string; dimension: string; decimalPlaces: number; fractionAllowed: boolean; status: string; isActive: boolean;
  itemCount: number; standardFactor: string | null; standardDimension: string | null; version: number;
};
export type ItemUnit = {
  uomId: string; code: string; name: string; symbol: string | null; category: string; decimals: number; factor: string; isBase: boolean; source: "base" | "item" | "standard";
  conversionId: string | null; purchasing: boolean; sales: boolean; inventory: boolean; isActive: boolean; uomActive: boolean; conversionStatus?: string;
  isPurchaseDefault: boolean; isSalesDefault: boolean; version: number | null; quantityPrecision?: number | null; text: string;
};
export type ItemUnits = {
  item: { id: string; code: string; baseUomId: string; baseUom: string; baseUomName: string; baseDecimals: number; purchaseUomId: string; salesUomId: string; serialTracked: boolean };
  units: ItemUnit[]; used: boolean;
};
export type UomHistoryEntry = { id: string; eventType: string; uomCode: string | null; from: Record<string, unknown> | null; to: Record<string, unknown> | null; reason: string | null; actorName: string | null; createdAt: string };
export type UnitInput = { uomId?: string; factor?: string; purchasingEnabled?: boolean; salesEnabled?: boolean; inventoryEnabled?: boolean; quantityPrecision?: number | null; reason?: string;
  expectedVersion?: number | null; acknowledgeHistory?: boolean };
export type ImportAnalysis = { fileName: string; headers: string[]; rowCount: number; sampleRows: Array<Record<string, string>>; suggestedMapping: Record<string, string>; fields: Array<{ key: string; label: string }> };
export type ImportRow = { rowNumber: number; name: string | null; outcome: "created" | "updated" | "skipped" | "failed"; message: string; productId?: string | null };
export type ImportResult = { dryRun: boolean; total: number; created: number; updated: number; skipped: number; failed: number; results: ImportRow[] };

const BASE = "/api/products";

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
function call<T>(path: string, init?: { method?: string; json?: unknown }) {
  return fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  }).then(parse<T>);
}
const upload = <T>(path: string, form: FormData) =>
  fetch(`${BASE}${path}`, { method: "POST", body: form, credentials: "same-origin", headers: { Accept: "application/json" } }).then(parse<T>);
const query = (params: object) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const getItemOptions = () => call<ItemOptions>("/options");
export const listItems = (filters: ItemFilters) => call<ItemList>(query(filters));
export const itemExportUrl = (filters: ItemFilters) => `${BASE}/export${query({ ...filters, limit: undefined, offset: undefined })}`;
export const getItem = (id: string) => call<{ product: Item }>(`/${id}`).then((response) => response.product);
export const createItem = (input: ItemInput) => call<{ product: Item }>("", { method: "POST", json: input }).then((response) => response.product);
export const updateItem = (id: string, input: ItemInput) => call<{ product: Item }>(`/${id}`, { method: "PATCH", json: input }).then((response) => response.product);
export const deleteItem = (id: string) => call<{ deleted: boolean }>(`/${id}`, { method: "DELETE", json: {} });
export const setItemStatus = (id: string, action: "activate" | "deactivate", reason?: string) =>
  call<{ product: Item }>(`/${id}/status`, { method: "POST", json: { action, reason } }).then((response) => response.product);
export const checkActivation = (id: string) => call<{ ready: boolean; issues: Array<{ field: string; message: string }> }>(`/${id}/activation`);
export const findDuplicateItems = (probe: { code?: string; name?: string; barcode?: string; manufacturerName?: string; manufacturerPartNumber?: string; excludeId?: string | null }) =>
  call<{ matches: DuplicateMatch[]; hasBlockingMatch: boolean }>("/duplicates", { method: "POST", json: probe });
export const lookupItem = (code: string) => call<{ match: { itemId: string; code: string; name: string; matchedBy: string; uom: string | null } | null }>(`/lookup${query({ code })}`).then((response) => response.match);
export const getItemDetails = (id: string) => call<{ details: ItemDetails }>(`/${id}/details`).then((response) => response.details);
export const listItemTransactions = (id: string, list: string) => call<{ rows: TransactionRow[] }>(`/${id}/transactions/${list}`).then((response) => response.rows);
export const listItemMovements = (id: string) => call<{ rows: Movement[] }>(`/${id}/transactions/stock`).then((response) => response.rows);
export const getItemHistory = (id: string) => call<{ history: HistoryEntry[] }>(`/${id}/history`).then((response) => response.history);
export const getItemInventory = (id: string) => call<{ inventory: InventorySummary }>(`/${id}/inventory`).then((response) => response.inventory);
export const getItemBatches = (id: string) => call<{ batches: Batch[] }>(`/${id}/batches`).then((response) => response.batches);
export const getItemSerials = (id: string) => call<{ serials: Serial[] }>(`/${id}/serials`).then((response) => response.serials);

export const listIdentifiers = (id: string, includeRemoved = false) =>
  call<{ identifiers: Identifier[] }>(`/${id}/identifiers${query({ includeRemoved: includeRemoved || undefined })}`).then((response) => response.identifiers);
export const addIdentifier = (id: string, input: { value: string; type: string; uomId?: string | null; isPrimary?: boolean }) =>
  call<{ identifiers: Identifier[] }>(`/${id}/identifiers`, { method: "POST", json: input });
export const removeIdentifier = (id: string, identifierId: string) => call<{ identifiers: Identifier[] }>(`/${id}/identifiers/${identifierId}`, { method: "DELETE", json: {} });
export const makePrimaryIdentifier = (id: string, identifierId: string) => call<{ identifiers: Identifier[] }>(`/${id}/identifiers/${identifierId}/primary`, { method: "POST", json: {} });

export const getItemUnits = (id: string) => call<{ units: ItemUnits }>(`/${id}/units`).then((response) => response.units);
export const getItemUomHistory = (id: string) => call<{ history: UomHistoryEntry[] }>(`/${id}/units/history`).then((response) => response.history);
export const setItemDefaultUnits = (id: string, input: { purchaseUomId?: string; salesUomId?: string; reason?: string }) =>
  call<{ units: ItemUnits }>(`/${id}/units/defaults`, { method: "POST", json: input }).then((response) => response.units);
export const addItemUnit = (id: string, input: UnitInput) => call<ItemUnits>(`/${id}/conversions`, { method: "POST", json: input });
export const updateItemUnit = (id: string, conversionId: string, input: UnitInput) => call<ItemUnits>(`/${id}/conversions/${conversionId}`, { method: "PATCH", json: input });
export const deactivateItemUnit = (id: string, conversionId: string, reason?: string) => call<ItemUnits>(`/${id}/conversions/${conversionId}`, { method: "DELETE", json: { reason } });
export const getVariants = (id: string) => call<{ template: { id: string; code: string; name: string; isVariantTemplate: boolean }; variants: Item[]; showsStock: boolean; totals?: { onHand: number; available: number } }>(`/${id}/variants`);
export const createVariant = (id: string, input: { attributes: Record<string, string>; code?: string; name?: string; barcode?: string; type?: string; trackingType?: string; status?: string }) =>
  call<{ product: Item }>(`/${id}/variants`, { method: "POST", json: input }).then((response) => response.product);

export const listItemFiles = (id: string) => call<{ files: ItemFile[] }>(`/${id}/files`).then((response) => response.files);
export const itemFileUrl = (id: string, fileId: string) => `${BASE}/${id}/files/${fileId}`;
export function uploadItemFile(id: string, file: File, makePrimaryImage = false) {
  const form = new FormData();
  form.set("file", file);
  form.set("makePrimaryImage", String(makePrimaryImage));
  return upload<{ file: ItemFile }>(`/${id}/files`, form).then((response) => response.file);
}
export const setPrimaryImage = (id: string, fileId: string) => call<{ imageAttachmentId: string | null }>(`/${id}/files/${fileId}`, { method: "PATCH", json: { primaryImage: true } });
export const removeItemFile = (id: string, fileId: string) => call<{ removed: boolean }>(`/${id}/files/${fileId}`, { method: "DELETE", json: {} });

export const listCategories = (filters: CategoryFilters = {}) => call<{ categories: Category[] }>(`/categories${query(filters)}`).then((response) => response.categories);
export const getCategory = (id: string) => call<{ category: Category }>(`/categories/${id}`).then((response) => response.category);
export const createCategory = (input: CategoryInput) => call<{ category: Category }>("/categories", { method: "POST", json: input }).then((response) => response.category);
export const updateCategory = (id: string, input: CategoryInput) =>
  call<{ category: Category }>(`/categories/${id}`, { method: "PATCH", json: input }).then((response) => response.category);
export const setCategoryStatus = (id: string, status: "active" | "inactive", reason?: string) =>
  call<{ category: Category }>(`/categories/${id}/status`, { method: "POST", json: { status, reason } }).then((response) => response.category);
export const deleteCategory = (id: string, reason?: string) => call<{ deleted: boolean }>(`/categories/${id}`, { method: "DELETE", json: { reason } });
export const moveCategory = (id: string, input: { parentId: string | null; reason?: string; expectedVersion?: number }) =>
  call<{ category: Category }>(`/categories/${id}/move`, { method: "POST", json: input }).then((response) => response.category);
export const getCategoryDefaults = (id: string) => call<{ defaults: Record<DefaultField, ResolvedDefault> }>(`/categories/${id}/defaults`).then((response) => response.defaults);
export const getCategoryItems = (id: string, includeSubcategories: boolean) =>
  call<ItemList>(`/categories/${id}/items${query({ includeSubcategories: includeSubcategories ? "yes" : undefined })}`);
export const getCategoryStock = (id: string, includeSubcategories: boolean) =>
  call<CategoryStock>(`/categories/${id}/stock${query({ includeSubcategories: includeSubcategories ? undefined : "no" })}`);
export const getCategoryReport = (key: string, range: { from?: string; to?: string } = {}) =>
  call<{ report: CategoryReport }>(`/categories/reports/${key}${query(range)}`).then((response) => response.report);
export const previewReclassify = (id: string, categoryId: string) =>
  call<{ preview: { differences: ReclassifyDifference[] } }>(`/${id}/reclassify${query({ categoryId })}`).then((response) => response.preview);
export const reclassifyItem = (id: string, input: { categoryId: string; adoptDefaults: boolean | DefaultField[]; reason?: string; expectedVersion?: number }) =>
  call<{ product: Item; newDefaults: ReclassifyDifference[] }>(`/${id}/reclassify`, { method: "POST", json: input });
export const reassignCategory = (id: string, targetCategoryId: string) =>
  call<{ moved: number; failed: Array<{ itemId: string; code: string; message: string }> }>(`/categories/${id}/reassign`, { method: "POST", json: { targetCategoryId } });

export const getSkuSettings = () => call<{ settings: SkuSettings }>("/sku-settings").then((response) => response.settings);
export const updateSkuSettings = (input: Partial<Pick<SkuSettings, "mode" | "defaultPrefix" | "separator" | "padding" | "includeYear" | "useCategoryPrefix" | "allowSkuChanges">> & { expectedVersion?: number }) =>
  call<{ settings: SkuSettings }>("/sku-settings", { method: "PATCH", json: input }).then((response) => response.settings);
export const previewSku = (categoryId: string | null) => call<{ preview: SkuPreview }>(`/sku/preview${query({ categoryId })}`).then((response) => response.preview);
export const checkSku = (sku: string, excludeId?: string | null) => call<{ check: SkuCheck }>(`/sku/availability${query({ sku, excludeId })}`).then((response) => response.check);
export const changeItemSku = (id: string, input: { sku: string; reason?: string; expectedVersion?: number }) =>
  call<{ product: Item }>(`/${id}/sku`, { method: "POST", json: input }).then((response) => response.product);
export const getSkuHistory = (id: string) => call<{ history: SkuHistoryEntry[] }>(`/${id}/sku`).then((response) => response.history);

export const listUnits = () => call<{ units: UnitOfMeasure[] }>("/units").then((response) => response.units);
export const createUnit = (input: { code: string; name: string; symbol?: string | null; category: string; decimalPlaces: number }) =>
  call<{ unit: UnitOfMeasure }>("/units", { method: "POST", json: input }).then((response) => response.unit);
export const updateUnit = (id: string, input: { name?: string; symbol?: string | null; category?: string; decimalPlaces?: number; expectedVersion?: number }) =>
  call<{ unit: UnitOfMeasure }>(`/units/${id}`, { method: "PATCH", json: input }).then((response) => response.unit);
export const setUnitStatus = (id: string, status: "active" | "inactive") => call<{ unit: UnitOfMeasure }>(`/units/${id}/status`, { method: "POST", json: { status } }).then((response) => response.unit);

export const itemImportTemplateUrl = `${BASE}/import/template`;
export function analyzeItemImport(file: File) {
  const form = new FormData();
  form.set("file", file);
  return upload<{ analysis: ImportAnalysis }>("/import/analyze", form).then((response) => response.analysis);
}
export function importItems(file: File, options: { mapping: Record<string, string>; existing: string; dryRun: boolean }) {
  const form = new FormData();
  form.set("file", file);
  form.set("mapping", JSON.stringify(options.mapping));
  form.set("existing", options.existing);
  form.set("dryRun", String(options.dryRun));
  return upload<{ result: ImportResult; errorFile: string | null }>("/import", form);
}

type Issue = { field: string; message: string };
export const errorMessage = (error: unknown, fallback = "Something went wrong. Try again.") => (error instanceof Error && error.message ? error.message : fallback);
export const errorCode = (error: unknown) => (error instanceof SalesApiError ? error.code : undefined);
export function fieldErrors(error: unknown): Record<string, string> {
  const issues = error instanceof SalesApiError ? (error.payload?.issues as Issue[] | undefined) : undefined;
  return Object.fromEntries((issues ?? []).map((issue) => [issue.field, issue.message]));
}
