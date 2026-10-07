type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };
type Choice = { code: string; label: string };

export class TaxError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(status: number, message: string, code?: string, details?: Record<string, unknown>);
}
export const TAX_PERMISSIONS: Readonly<Record<"view" | "manageCategories" | "manageRates" | "manageRegistrations" | "overrideTransaction" | "overridePlaceOfSupply" | "viewAudit", string>>;
export const TAX_TYPES: ReadonlyArray<Choice>;
export const TAX_TREATMENTS: ReadonlyArray<Choice>;
export const TAX_APPLIES_TO: ReadonlyArray<Choice>;
export const SUPPLY_TYPES: ReadonlyArray<Choice & { treatment: string }>;
export const GST_STATES: ReadonlyArray<{ code: string; name: string }>;
export function gstStateName(code: unknown): string | null;
export function gstStateCode(name: unknown): string | null;
export function supplyTypeForCustomer(registrationType: string | null | undefined): string;
export function treatmentOfSupply(supplyType: string | null | undefined): string;

// The one tax calculation.
export function loadTaxContext(client: QueryClient, input: { organizationId: string; sellerRegistrationId?: string | null }): Promise<any>;
export function resolveLineTax(client: QueryClient, tax: any, input: Record<string, any>): Promise<any>;
export function computeTax(input: { base: bigint | string | number; inclusive?: boolean; components: Array<{ type: string; label: string; rate: bigint }>; decimalPlaces?: number }): any;
export function derivePlaceOfSupply(input: Record<string, unknown>): { code: string; name: string | null; basis: string } | null;
export function sellerSnapshot(registration: Record<string, any>): Record<string, any>;
export function summarizeTax(lines: Array<Record<string, any>>): Array<Record<string, any>>;

// Configuration.
export function listTaxCategories(client: QueryClient, context: Context, filters?: Record<string, any>): Promise<any[]>;
export function listTaxCategoryChoices(client: QueryClient, context: Context): Promise<Array<{ id: string; code: string; name: string; treatment: string; appliesTo: string; rate: number | null }>>;
export function getTaxCategory(client: QueryClient, context: Context, categoryId: string): Promise<any>;
export function createTaxCategory(client: QueryClient, context: Context, input: Record<string, any>): Promise<any>;
export function updateTaxCategory(client: QueryClient, context: Context, categoryId: string, input: Record<string, any>): Promise<any>;
export function setTaxCategoryStatus(client: QueryClient, context: Context, categoryId: string, active: boolean): Promise<any>;
export function changeTaxRate(client: QueryClient, context: Context, categoryId: string, input: { rate: number; cessRate?: number | null; effectiveFrom: string }): Promise<any>;
export function listTaxRegistrations(client: QueryClient, context: Context, filters?: { status?: string }): Promise<any[]>;
export function createTaxRegistration(client: QueryClient, context: Context, input: Record<string, any>): Promise<any>;
export function updateTaxRegistration(client: QueryClient, context: Context, registrationId: string, input: Record<string, any>): Promise<any>;
export function getTaxSettings(client: QueryClient, context: Context): Promise<{ countryCode: string | null; taxEnabled: boolean; defaultTaxCategoryId: string | null; defaultTaxCategoryName: string | null }>;
export function updateTaxSettings(client: QueryClient, context: Context, input: { taxEnabled?: boolean; defaultTaxCategoryId?: string | null }): Promise<any>;
export function getTaxOptions(client: QueryClient, context: Context): Promise<any>;
export function listTaxHistory(client: QueryClient, context: Context, filters?: { entityType?: string; entityId?: string; limit?: number }): Promise<any[]>;
export declare function listWithholdingSections(client: any, context: any, options?: { includeInactive?: boolean }): Promise<Array<{ id: string; code: string; name: string; rate: string; status: string }>>;
export declare function saveWithholdingSection(client: any, context: any, sectionId: string | null, input?: Record<string, unknown>): Promise<{ id: string; code: string; name: string; rate: string; status: string }>;
