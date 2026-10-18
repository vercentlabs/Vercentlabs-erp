// Exchange rates (types for the web).
type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Context = { organizationId: string; userId: string | null; permissions: readonly string[]; roleSlugs: readonly string[] };
export type ExchangeRate = { id: string; fromCurrencyCode: string; fromCurrencyName: string | null; toCurrencyCode: string; rateDate: string; rate: number; source: string; status: "active" | "inactive"; updatedAt: string; updatedByName: string | null };
export type ExchangeRateList = { baseCurrency: string; rates: ExchangeRate[]; currencies: Array<{ code: string; name: string; currentRate: number | null; currentRateDate: string | null }>; can: { manage: boolean } };
export declare const EXCHANGE_RATE_PERMISSIONS: Readonly<{ view: string; manage: string }>;
export declare class ExchangeRateError extends Error { status: number; code: string; details?: unknown; constructor(status: number, message: string, code?: string, details?: unknown); }
export declare function listExchangeRates(client: Client, context: Context, filters?: { currency?: string; status?: string }): Promise<ExchangeRateList>;
export declare function getExchangeRate(client: Client, context: Context, rateId: string): Promise<ExchangeRate>;
export declare function setExchangeRate(client: Client, context: Context, input: Record<string, unknown>): Promise<ExchangeRate>;
export declare function setExchangeRateStatus(client: Client, context: Context, rateId: string, status: string): Promise<ExchangeRate>;
