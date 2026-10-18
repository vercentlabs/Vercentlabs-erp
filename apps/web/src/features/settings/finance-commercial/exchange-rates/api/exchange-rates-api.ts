"use client";

// Settings → Exchange rates (services/api/src/core/exchange-rates): dated rates into the base currency.
export type ExchangeRate = { id: string; fromCurrencyCode: string; fromCurrencyName: string | null; toCurrencyCode: string; rateDate: string; rate: number; source: string; status: "active" | "inactive";
  updatedAt: string; updatedByName: string | null };
export type ExchangeRateList = { baseCurrency: string; rates: ExchangeRate[]; currencies: Array<{ code: string; name: string; currentRate: number | null; currentRateDate: string | null }>; can: { manage: boolean } };

export class ExchangeRateApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | undefined, readonly field: string | undefined) { super(message); }
}
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/settings/exchange-rates${path}`, {
    credentials: "same-origin", ...init, headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new ExchangeRateApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload.details?.field);
  return payload;
}
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
export const listExchangeRates = (status: string, currency?: string) => {
  const search = new URLSearchParams({ status, ...(currency ? { currency } : {}) }).toString();
  return call<ExchangeRateList>(`?${search}`);
};
export const setExchangeRate = (input: { fromCurrencyCode: string; rateDate: string; rate: string }) => call<{ rate: ExchangeRate }>("", { method: "POST", body: JSON.stringify(input) });
export const setExchangeRateStatus = (id: string, status: "active" | "inactive") => call<{ rate: ExchangeRate }>(`/${id}/status`, { method: "POST", body: JSON.stringify({ status }) });
