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
  "view" | "create" | "edit" | "activate" | "delete" | "import" | "export" | "editPricing" | "editTax" | "editInventory" | "viewCost" | "editCost", string>>;
export const PRODUCT_RELATED_LISTS: readonly string[];
export const PRODUCT_IMPORT_FIELDS: ReadonlyArray<{ key: string; label: string; aliases: string[]; sample: string }>;

export function productCan(context: Context, permission: string): boolean;
export function canViewProductCost(context: Context): boolean;
export function productCapabilities(context: Context): Record<string, boolean>;

export function getProductOptions(client: Client, context: Context): Promise<any>;
export function listProducts(client: Client, context: Context, filters?: Input): Promise<any>;
export function getProduct(client: Client, context: Context, productId: string): Promise<any>;
export function createProduct(client: Client, context: Context, input: Input, options?: { origin?: string }): Promise<any>;
export function updateProduct(client: Client, context: Context, productId: string, input: Input): Promise<any>;
export function activateProduct(client: Client, context: Context, productId: string, input?: Input): Promise<any>;
export function deactivateProduct(client: Client, context: Context, productId: string, input?: Input): Promise<any>;
export function deleteProduct(client: Client, context: Context, productId: string): Promise<{ deleted: true }>;
export function productUses(client: Client, context: Context, productId: string, options?: { only?: string[] | null }): Promise<string[]>;
export function findDuplicateProducts(client: Client, context: Context, input: Input, options?: { excludeId?: string | null; limit?: number }): Promise<any>;

export function getProductDetails(client: Client, context: Context, productId: string): Promise<any>;
export function listProductTransactions(client: Client, context: Context, productId: string, list: string): Promise<any[]>;
export function getProductHistory(client: Client, context: Context, productId: string): Promise<any[]>;

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
