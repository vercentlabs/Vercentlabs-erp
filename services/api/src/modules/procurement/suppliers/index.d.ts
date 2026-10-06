type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };
type Coded = ReadonlyArray<{ code: string; label: string }>;

export class SupplierError extends Error { readonly status: number; readonly code: string; readonly details?: any; constructor(status: number, message: string, code?: string, details?: unknown); }
export const SUPPLIER_PERMISSIONS: Readonly<Record<string, string>>;
export const SUPPLIER_STATUS: Readonly<{ active: "active"; inactive: "inactive"; blocked: "blocked" }>;
export const SUPPLIER_TYPES: Coded;
export const SUPPLIER_CATEGORIES: Coded;
export const SUPPLIER_ADDRESS_TYPES: Coded;
export const SUPPLIER_CONTACT_ROLES: Coded;
export const SUPPLIER_GST_REGISTRATION_TYPES: ReadonlyArray<{ code: string; label: string; needsGstin: boolean }>;
export const SUPPLIER_VIEWS: ReadonlyArray<{ key: string; label: string }>;
export const SUPPLIER_IMPORT_FIELDS: ReadonlyArray<{ key: string; label: string; aliases: string[]; sample: string }>;
export function supplierCan(context: Context, permission: string): boolean;

export function createSupplier(client: QueryClient, context: Context, input?: Record<string, any>): Promise<any>;
export function updateSupplier(client: QueryClient, context: Context, supplierId: string, input?: Record<string, any>): Promise<any>;
export function getSupplier(client: QueryClient, context: Context, supplierId: string): Promise<any>;
export function listSuppliers(client: QueryClient, context: Context, filters?: Record<string, any>): Promise<{ rows: any[]; total: number; limit: number; offset: number; views: any[] }>;
export function searchSuppliers(client: QueryClient, context: Context, input?: { search?: string; limit?: number }): Promise<any[]>;
export function getSupplierFormOptions(client: QueryClient, context: Context): Promise<any>;
export function checkSupplierDuplicates(client: QueryClient, context: Context, probe?: Record<string, any>, options?: { excludeSupplierId?: string | null; excludePartyId?: string | null }): Promise<any[]>;

export function activateSupplier(client: QueryClient, context: Context, supplierId: string, input?: Record<string, any>): Promise<any>;
export function deactivateSupplier(client: QueryClient, context: Context, supplierId: string, input?: Record<string, any>): Promise<any>;
export function blockSupplier(client: QueryClient, context: Context, supplierId: string, input?: Record<string, any>): Promise<any>;
export function unblockSupplier(client: QueryClient, context: Context, supplierId: string, input?: Record<string, any>): Promise<any>;
export function deleteSupplier(client: QueryClient, context: Context, supplierId: string): Promise<{ deleted: boolean; supplierNumber: string; partyRemoved: boolean }>;

export function addSupplierAddress(client: QueryClient, context: Context, supplierId: string, input?: Record<string, any>): Promise<{ addressId: string }>;
export function updateSupplierAddress(client: QueryClient, context: Context, supplierId: string, addressId: string, input?: Record<string, any>): Promise<{ addressId: string }>;
export function setSupplierAddressStatus(client: QueryClient, context: Context, supplierId: string, addressId: string, active: boolean): Promise<{ addressId: string; changed: boolean }>;
export function addSupplierContact(client: QueryClient, context: Context, supplierId: string, input?: Record<string, any>): Promise<{ relationshipId: string; contactId: string }>;
export function updateSupplierContact(client: QueryClient, context: Context, supplierId: string, relationshipId: string, input?: Record<string, any>): Promise<{ relationshipId: string }>;
export function setSupplierContactStatus(client: QueryClient, context: Context, supplierId: string, relationshipId: string, active: boolean): Promise<{ relationshipId: string; changed: boolean }>;

export function listSupplierPaymentDetails(client: QueryClient, context: Context, supplierId: string): Promise<{ accounts: any[]; canManage: boolean }>;
export function addSupplierBankAccount(client: QueryClient, context: Context, supplierId: string, input?: Record<string, any>): Promise<{ accountId: string }>;
export function updateSupplierBankAccount(client: QueryClient, context: Context, supplierId: string, accountId: string, input?: Record<string, any>): Promise<{ accountId: string }>;

export function getSupplierPurchaseSummary(client: QueryClient, context: Context, supplierId: string): Promise<any>;
export function getSupplierPayablesSummary(client: QueryClient, context: Context, supplierId: string): Promise<any>;
export function listSupplierDocuments(client: QueryClient, context: Context, supplierId: string, kind: string): Promise<any[]>;
export function listSupplierHistory(client: QueryClient, context: Context, supplierId: string): Promise<any[]>;

export function assertSupplierUsable(client: QueryClient, organizationId: string, supplierId: string, options?: { purpose?: string }): Promise<any>;
export function supplierDefaultsFor(client: QueryClient, organizationId: string, supplierId: string, options?: { purpose?: string }): Promise<any>;
export function resolveSupplierDefaults(client: QueryClient, context: Context, supplierId: string): Promise<any>;

export function prepareSupplierFileUpload(input: { fileName: string; bytes: Uint8Array }, env?: Record<string, string | undefined>): Promise<any>;
export function listSupplierFiles(client: QueryClient, context: Context, supplierId: string): Promise<any[]>;
export function uploadSupplierFile(client: QueryClient, context: Context, supplierId: string, input?: Record<string, any>, options?: Record<string, any>): Promise<any>;
export function removeSupplierFile(client: QueryClient, context: Context, supplierId: string, fileId: string): Promise<{ removed: boolean }>;
export function readSupplierFile(client: QueryClient, context: Context, supplierId: string, fileId: string, options?: Record<string, any>): Promise<any>;

export function buildSupplierImportTemplate(): string;
export function analyzeSupplierImport(client: QueryClient, context: Context, input: { bytes: Uint8Array; fileName: string }): Promise<any>;
export function importSuppliers(client: QueryClient, context: Context, input: { bytes: Uint8Array; fileName: string; mapping?: Record<string, string>; dryRun?: boolean; defaults?: Record<string, any> }): Promise<any>;
export function buildSupplierImportErrorFile(results: any[]): string;
export function exportSuppliers(client: QueryClient, context: Context, filters?: Record<string, any>): Promise<{ fileName: string; csv: string; count: number }>;
