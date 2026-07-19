export const DEFAULT_LOCALE: "en-IN";
export const DEFAULT_TIMEZONE: "Asia/Kolkata";
export const DEFAULT_CURRENCY: "INR";
export function normalizeCurrency(value?: unknown, fallback?: string): string;
export function assertTimeZone(value?: unknown): string;
export function formatMoney(amount: unknown, options?: { locale?: string; currency?: string; maximumFractionDigits?: number }): string;
export function formatDateTime(value: string | number | Date, options?: { locale?: string; timeZone?: string; dateStyle?: "full" | "long" | "medium" | "short"; timeStyle?: "full" | "long" | "medium" | "short" }): string;
export function fiscalYearFor(value?: string | number | Date, startMonth?: number): Readonly<{ startYear: number; endYear: number; label: string }>;
