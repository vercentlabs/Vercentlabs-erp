type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Principal = { organizationId: string; developerAppId: string; apiKeyId: string; scopes: readonly string[] };
type Page<T = Record<string, unknown>> = { data: T[]; total: number; limit: number; offset: number };
type One<T = Record<string, unknown>> = { data: T };
export const API_SCOPE_PERMISSIONS: Readonly<Record<string, readonly string[]>>;
export class PublicApiError extends Error { status: number; code: string }
export function apiListCustomers(client: Client, principal: Principal, query?: Record<string, string>): Promise<Page>;
export function apiGetCustomer(client: Client, principal: Principal, id: string): Promise<One>;
export function apiCreateCustomer(client: Client, principal: Principal, input: Record<string, unknown>): Promise<One>;
export function apiListItems(client: Client, principal: Principal, query?: Record<string, string>): Promise<Page>;
export function apiGetItem(client: Client, principal: Principal, id: string): Promise<One>;
export function apiCreateItem(client: Client, principal: Principal, input: Record<string, unknown>): Promise<One>;
export function apiListSalesOrders(client: Client, principal: Principal, query?: Record<string, string>): Promise<Page>;
export function apiGetSalesOrder(client: Client, principal: Principal, id: string): Promise<One>;
export function apiCreateSalesOrder(client: Client, principal: Principal, input: Record<string, unknown>): Promise<One>;
export function apiListInvoices(client: Client, principal: Principal, query?: Record<string, string>): Promise<Page>;
export function apiGetInvoice(client: Client, principal: Principal, id: string): Promise<One>;
export function apiStockLevels(client: Client, principal: Principal, query?: Record<string, string>): Promise<Page>;
export function apiListPayments(client: Client, principal: Principal, query?: Record<string, string>): Promise<Page>;
