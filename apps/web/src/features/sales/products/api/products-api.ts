"use client";

// Browser client for the product and service catalogue under /api/products.
import { SalesApiError } from "@/features/sales/shared/http";

export type ProductType = "stock" | "non_stock" | "service";
export type ProductCapabilities = Record<
  "view" | "create" | "edit" | "activate" | "delete" | "import" | "export" | "editPricing" | "editTax" | "editInventory" | "viewCost" | "editCost", boolean>;
type Unit = { code: string; name: string } | null;

export type Product = {
  id: string;
  code: string;
  name: string;
  type: ProductType;
  typeLabel: string;
  isService: boolean;
  categoryId: string | null;
  categoryName: string | null;
  description: string | null;
  salesDescription: string | null;
  purchaseDescription: string | null;
  sku: string | null;
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
  trackingType: "none" | "batch" | "serial";
  allowNegativeStock: boolean;
  requiresExpiryDate: boolean;
  valuationMethod: "moving_average" | "fifo" | "standard";
  hsnSacCode: string | null;
  hsnSacLabel: "HSN" | "SAC";
  taxCategoryId: string | null;
  taxCategoryName: string | null;
  gstRate: number | null;
  cessRate: number | null;
  defaultSalesPrice: number;
  defaultPurchaseCost?: number;
  standardCost?: number;
  imageAttachmentId: string | null;
  status: "active" | "inactive";
  isActive: boolean;
  createdByName: string | null;
  createdAt: string;
  updatedByName: string | null;
  updatedAt: string;
  capabilities?: ProductCapabilities;
};

export type ProductInput = Partial<{
  type: ProductType; code: string; name: string; categoryId: string | null; description: string | null; salesDescription: string | null; purchaseDescription: string | null;
  sku: string | null; barcode: string | null; baseUomId: string; salesUomId: string | null; salesUomFactor: number | null; purchaseUomId: string | null; purchaseUomFactor: number | null;
  isSellable: boolean; isPurchasable: boolean; hsnSacCode: string | null; taxCategoryId: string | null; defaultSalesPrice: number | null; defaultPurchaseCost: number | null;
  standardCost: number | null; trackingType: string; allowNegativeStock: boolean; requiresExpiryDate: boolean; valuationMethod: string; status: string;
}>;

export type ProductOptions = {
  types: Array<{ code: ProductType; label: string; goods: boolean }>;
  views: Array<{ key: string; label: string }>;
  categories: Array<{ id: string; name: string }>;
  uoms: Array<{ id: string; code: string; name: string; category: string }>;
  taxCategories: Array<{ id: string; code: string; name: string; gstRate: number | null; cessRate: number | null }>;
  showsCost: boolean;
  capabilities: ProductCapabilities;
};

export type ProductFilters = Partial<Record<"view" | "search" | "type" | "categoryId" | "status" | "sellable" | "purchasable" | "inventoryTracked" | "hsnSac" | "taxCategoryId" | "sort" | "direction", string>> & {
  limit?: number; offset?: number;
};
export type ProductList = { products: Product[]; total: number; views: Array<{ key: string; label: string }>; showsCost: boolean; capabilities: ProductCapabilities };

export type DuplicateMatch = { id: string; code: string; name: string; type: ProductType; status: string; strength: "strong" | "possible"; reasons: Array<{ signal: string; label: string }>; href: string };

export type ProductDetails = {
  product: Product;
  access: { sales: boolean; procurement: boolean; inventory: boolean; cost: boolean };
  sales: { priceLists: Array<{ id: string; name: string; currencyCode: string | null; taxInclusive: boolean; rate: number; minimumQuantity: number; uom: string | null; validFrom: string | null; validTo: string | null }> };
  inventory?: {
    onHand: number; reserved: number; available: number; uom: string | null; value?: number;
    warehouses: Array<{ id: string; code: string; name: string; onHand: number; reserved: number; available: number; averageCost?: number | null }>;
  };
};
export type TransactionRow = { id: string; code: string; party: string | null; status: string | null; quantity: number | null; uom: string | null; amount: number | null; currencyCode: string | null; date: string; href: string | null };
export type HistoryEntry = { id: string; eventType: string; summary: string; changes: Record<string, unknown>; createdAt: string; actorName: string | null };
export type ProductFile = { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string; isImage: boolean; isPrimaryImage: boolean };
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

export const getProductOptions = () => call<ProductOptions>("/options");
export const listProducts = (filters: ProductFilters) => call<ProductList>(query(filters));
export const productExportUrl = (filters: ProductFilters) => `${BASE}/export${query({ ...filters, limit: undefined, offset: undefined })}`;
export const getProduct = (id: string) => call<{ product: Product }>(`/${id}`).then((response) => response.product);
export const createProduct = (input: ProductInput) => call<{ product: Product }>("", { method: "POST", json: input }).then((response) => response.product);
export const updateProduct = (id: string, input: ProductInput) => call<{ product: Product }>(`/${id}`, { method: "PATCH", json: input }).then((response) => response.product);
export const deleteProduct = (id: string) => call<{ deleted: boolean }>(`/${id}`, { method: "DELETE", json: {} });
export const setProductStatus = (id: string, action: "activate" | "deactivate", reason?: string) =>
  call<{ product: Product }>(`/${id}/status`, { method: "POST", json: { action, reason } }).then((response) => response.product);
export const findDuplicateProducts = (probe: { code?: string; name?: string; sku?: string; barcode?: string; excludeId?: string | null }) =>
  call<{ matches: DuplicateMatch[]; hasBlockingMatch: boolean }>("/duplicates", { method: "POST", json: probe });
export const getProductDetails = (id: string) => call<{ details: ProductDetails }>(`/${id}/details`).then((response) => response.details);
export const listProductTransactions = (id: string, list: string) => call<{ rows: TransactionRow[] }>(`/${id}/transactions/${list}`).then((response) => response.rows);
export const getProductHistory = (id: string) => call<{ history: HistoryEntry[] }>(`/${id}/history`).then((response) => response.history);

export const listProductFiles = (id: string) => call<{ files: ProductFile[] }>(`/${id}/files`).then((response) => response.files);
export const productFileUrl = (id: string, fileId: string) => `${BASE}/${id}/files/${fileId}`;
export function uploadProductFile(id: string, file: File, makePrimaryImage = false) {
  const form = new FormData();
  form.set("file", file);
  form.set("makePrimaryImage", String(makePrimaryImage));
  return upload<{ file: ProductFile }>(`/${id}/files`, form).then((response) => response.file);
}
export const setPrimaryImage = (id: string, fileId: string) => call<{ imageAttachmentId: string | null }>(`/${id}/files/${fileId}`, { method: "PATCH", json: { primaryImage: true } });
export const removeProductFile = (id: string, fileId: string) => call<{ removed: boolean }>(`/${id}/files/${fileId}`, { method: "DELETE", json: {} });

export const productImportTemplateUrl = `${BASE}/import/template`;
export function analyzeProductImport(file: File) {
  const form = new FormData();
  form.set("file", file);
  return upload<{ analysis: ImportAnalysis }>("/import/analyze", form).then((response) => response.analysis);
}
export function importProducts(file: File, options: { mapping: Record<string, string>; existing: string; dryRun: boolean }) {
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
