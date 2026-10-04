/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };
type Input = Record<string, any>;

export class CustomerError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(status: number, message: string, code?: string, details?: Record<string, unknown>);
}
export const CUSTOMER_PERMISSIONS: Readonly<Record<
  | "view" | "viewTeam" | "viewAll" | "create" | "edit" | "inactivate" | "reactivate" | "block" | "unblock" | "delete" | "import" | "export"
  | "manageAddresses" | "manageContacts" | "linkAccount" | "editGstin" | "changeCurrency" | "changePaymentTerms" | "changePriceList" | "viewFinancials"
  | "viewAddresses" | "inactivateAddress" | "setDefaultBilling" | "setDefaultShipping" | "editAddressGstin" | "viewContacts" | "inactivateContact" | "setPrimaryContact", string>>;
export const CUSTOMER_RELATED_LISTS: readonly string[];
export const CUSTOMER_IMPORT_FIELDS: ReadonlyArray<{ key: string; label: string; aliases: string[]; sample: string }>;

export function customerCan(context: Context, permission: string): boolean;
export function canViewCustomerFinancials(context: Context): boolean;
export function customerCapabilities(context: Context): Record<string, boolean>;

export function getCustomerOptions(client: Client, context: Context): Promise<any>;
export function listCustomers(client: Client, context: Context, filters?: Input): Promise<any>;
export function searchCustomers(client: Client, context: Context, search?: string, options?: { limit?: number }): Promise<any[]>;
export function getCustomer(client: Client, context: Context, customerId: string): Promise<any>;
export function createCustomer(client: Client, context: Context, input: Input): Promise<any>;
export function updateCustomer(client: Client, context: Context, customerId: string, input: Input): Promise<any>;
export function deleteCustomer(client: Client, context: Context, customerId: string): Promise<{ deleted: true }>;

export function activateCustomer(client: Client, context: Context, customerId: string, input?: Input): Promise<any>;
export function deactivateCustomer(client: Client, context: Context, customerId: string, input?: Input): Promise<any>;
export function blockCustomer(client: Client, context: Context, customerId: string, input?: Input): Promise<any>;
export function unblockCustomer(client: Client, context: Context, customerId: string, input?: Input): Promise<any>;

export function listCustomerAddresses(client: Client, context: Context, customerId: string, options?: { includeInactive?: boolean; search?: string }): Promise<any[]>;
export function deactivateCustomerAddress(client: Client, context: Context, customerId: string, addressId: string): Promise<any>;
export function findDuplicateCustomerAddress(client: Client, context: Context, customerId: string, address: Input, exceptId?: string | null): Promise<any[]>;
export function addCustomerAddress(client: Client, context: Context, customerId: string, input: Input): Promise<any>;
export function updateCustomerAddress(client: Client, context: Context, customerId: string, addressId: string, input: Input): Promise<any>;
export function setDefaultBillingAddress(client: Client, context: Context, customerId: string, addressId: string): Promise<any>;
export function setDefaultShippingAddress(client: Client, context: Context, customerId: string, addressId: string): Promise<any>;
export function setCustomerAddressActive(client: Client, context: Context, customerId: string, addressId: string, active: boolean): Promise<any>;

export function listCustomerContacts(client: Client, context: Context, customerId: string, options?: { includeInactive?: boolean; search?: string; addressId?: string | null }): Promise<any[]>;
export function findExistingContact(client: Client, context: Context, customerId: string, input: Input): Promise<{ matches: any[] }>;
export function deactivateCustomerContact(client: Client, context: Context, customerId: string, contactId: string, options?: { confirmOpenDocuments?: boolean }): Promise<any>;
export function addCustomerContact(client: Client, context: Context, customerId: string, input: Input): Promise<any>;
export function linkCustomerContact(client: Client, context: Context, customerId: string, input: Input): Promise<any>;
export function updateCustomerContact(client: Client, context: Context, customerId: string, contactId: string, input: Input): Promise<any>;
export function setPrimaryCustomerContact(client: Client, context: Context, customerId: string, contactId: string): Promise<any>;
export function setBillingCustomerContact(client: Client, context: Context, customerId: string, contactId: string): Promise<any>;
export function setShippingCustomerContact(client: Client, context: Context, customerId: string, contactId: string): Promise<any>;
export function searchLinkableCustomerContacts(client: Client, context: Context, customerId: string, search?: string): Promise<any[]>;

export function findDuplicateCustomers(client: Client, context: Context, input: Input, options?: { excludeId?: string | null; limit?: number }): Promise<any>;
export function searchAccountsForCustomer(client: Client, context: Context, search?: string): Promise<any[]>;
export function getCustomerPrefillFromAccount(client: Client, context: Context, accountId: string): Promise<any>;
export function createCustomerFromAccount(client: Client, context: Context, accountId: string, input?: Input): Promise<any>;
export function linkCustomerToAccount(client: Client, context: Context, customerId: string, accountId: string): Promise<any>;

export function getCustomerOverview(client: Client, context: Context, customerId: string): Promise<any>;
export function listCustomerRelated(client: Client, context: Context, customerId: string, list: string): Promise<any[]>;
export function listCustomerHistory(client: Client, context: Context, customerId: string): Promise<any[]>;

export function analyzeCustomerImport(client: Client, context: Context, input: { bytes: Uint8Array | Buffer; fileName: string }): Promise<any>;
export function importCustomers(client: Client, context: Context, input: { bytes: Uint8Array | Buffer; fileName: string; mapping?: Record<string, string>; duplicateMode?: string; dryRun?: boolean; defaults?: Input }): Promise<any>;
export function buildCustomerImportTemplate(): string;
export function analyzeCustomerRelatedImport(client: Client, context: Context, kind: string, input: { bytes: Uint8Array | Buffer; fileName: string }): Promise<any>;
export function importCustomerRelated(client: Client, context: Context, kind: string, input: { bytes: Uint8Array | Buffer; fileName: string; mapping?: Record<string, string>; dryRun?: boolean }): Promise<any>;
export function buildCustomerRelatedImportTemplate(kind: string): string;
export function exportCustomerRelated(client: Client, context: Context, kind: string, filters?: Input): Promise<{ fileName: string; csv: string; count: number }>;
export function buildCustomerImportErrorFile(results: any[]): string;
export function exportCustomers(client: Client, context: Context, filters?: Input): Promise<{ fileName: string; csv: string; count: number }>;
