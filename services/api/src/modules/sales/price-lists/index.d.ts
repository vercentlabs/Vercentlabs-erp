/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };
type Input = Record<string, any>;

export class PriceListError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(status: number, message: string, code?: string, details?: Record<string, unknown>);
}
export const PRICE_LIST_PERMISSIONS: Readonly<Record<"view" | "create" | "edit" | "managePrices" | "activate" | "setDefault" | "changeTaxMode" | "import" | "export" | "overridePrice", string>>;
export const PRICE_IMPORT_FIELDS: ReadonlyArray<{ key: string; label: string; aliases: string[]; sample: string }>;
export type ResolvedPriceList = { id: string; code: string; name: string; currencyCode: string; taxInclusive: boolean; isDefault: boolean; basis: "chosen" | "customer" | "default" };

export function priceListCan(context: Context, permission: string): boolean;
export function priceListCapabilities(context: Context): Record<string, boolean>;

export function listPriceLists(client: Client, context: Context, filters?: Input): Promise<any>;
export function listUsablePriceLists(client: Client, context: Context, currencyCode?: string | null, documentDate?: string): Promise<any[]>;
export function getPriceList(client: Client, context: Context, priceListId: string): Promise<any>;
export function createPriceList(client: Client, context: Context, input: Input): Promise<any>;
export function updatePriceList(client: Client, context: Context, priceListId: string, input: Input): Promise<any>;
export function setDefaultPriceList(client: Client, context: Context, priceListId: string): Promise<any>;
export function activatePriceList(client: Client, context: Context, priceListId: string, input?: Input): Promise<any>;
export function deactivatePriceList(client: Client, context: Context, priceListId: string, input?: Input): Promise<any>;
export function deletePriceList(client: Client, context: Context, priceListId: string): Promise<{ deleted: true }>;
export function copyPriceList(client: Client, context: Context, priceListId: string, input: Input): Promise<any>;
export function priceListReferences(client: Client, context: Context, priceListId: string, options?: { only?: string[] | null }): Promise<string[]>;

export function listPriceListEntries(client: Client, context: Context, priceListId: string, filters?: Input): Promise<any>;
export function addPrice(client: Client, context: Context, priceListId: string, input: Input): Promise<any>;
export function updatePrice(client: Client, context: Context, priceListId: string, entryId: string, input: Input): Promise<any>;
export function expirePrice(client: Client, context: Context, priceListId: string, entryId: string, input?: Input): Promise<any>;
export function removePrice(client: Client, context: Context, priceListId: string, entryId: string): Promise<any>;
export function getProductPriceHistory(client: Client, context: Context, priceListId: string, productId: string): Promise<any[]>;
export function listPriceListHistory(client: Client, context: Context, priceListId: string, options?: { itemId?: string | null }): Promise<any[]>;

export function resolveSalesPriceList(client: Client, context: Context, input: { priceListId?: string | null; partyId?: string | null; currencyCode: string; documentDate?: string }): Promise<ResolvedPriceList | null>;
export function resolveSalesPrice(client: Client, context: Context, input: { priceList: ResolvedPriceList | null; itemId: string; variantId?: string | null; uomId?: string | null; documentDate?: string }): Promise<{
  listPrice: string; source: string; entryId: string | null; priceList: ResolvedPriceList | null; uomId: string; factor: number; missing: boolean; message: string | null;
}>;
export function unitFactor(client: Client, context: Context, itemId: string, uomId: string, baseUomId: string): Promise<number | null>;

export function analyzePriceImport(client: Client, context: Context, priceListId: string, input: { bytes: Uint8Array | Buffer; fileName: string }): Promise<any>;
export function importPrices(client: Client, context: Context, priceListId: string, input: { bytes: Uint8Array | Buffer; fileName: string; mapping?: Record<string, string>; dryRun?: boolean }): Promise<any>;
export function buildPriceImportTemplate(): string;
export function buildPriceImportErrorFile(results: any[]): string;
export function exportPrices(client: Client, context: Context, priceListId: string, options?: { state?: string }): Promise<{ fileName: string; csv: string; count: number }>;
