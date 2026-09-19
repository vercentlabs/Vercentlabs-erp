import { del, post, request } from "@/features/sales/shared/http";
import type { SalesCustomerPrice, SalesPriceList, SalesPriceListItem, SalesPricingOptions } from "@/features/sales/price-lists/types/price-lists";

export const listSalesPriceLists = () => request<{ rows: SalesPriceList[] }>("/price-lists");

export const createSalesPriceList = (input: { code: string; name: string; currencyCode?: string; taxInclusive?: boolean; validFrom?: string | null; validTo?: string | null }) =>
  post<{ priceList: SalesPriceList }>("/price-lists", input);

export const listSalesPriceListItems = (priceListId: string, query: { limit?: number; offset?: number } = {}) => {
  const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
  return request<{ priceList: { id: string; code: string; name: string; currency_code: string }; rows: SalesPriceListItem[]; total: number }>(
    `/price-lists/${priceListId}/items${params.size ? `?${params}` : ""}`,
  );
};

export const upsertSalesPriceListItem = (
  priceListId: string,
  input: { itemId: string; variantId?: string | null; minimumQuantity?: number; rate: number; validFrom?: string | null; validTo?: string | null },
) => post<{ item: SalesPriceListItem }>(`/price-lists/${priceListId}/items`, input);

export const deactivateSalesPriceListItem = (id: string) => del<{ item: { id: string; status: string } }>(`/price-list-items/${id}`);

export const listSalesCustomerPrices = (query: { limit?: number; offset?: number } = {}) => {
  const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
  return request<{ rows: SalesCustomerPrice[]; total: number }>(`/customer-prices${params.size ? `?${params}` : ""}`);
};

export const upsertSalesCustomerPrice = (input: {
  partyId: string;
  itemId: string;
  priceListId?: string | null;
  minimumQuantity?: number;
  fixedRate: number;
  validFrom?: string | null;
  validTo?: string | null;
  reason: string;
}) => post<{ rule: { id: string } }>("/customer-prices", input);

export const deactivateSalesCustomerPrice = (id: string) => del<{ rule: { id: string; status: string } }>(`/customer-prices/${id}`);

export const getSalesPricingOptions = () => request<SalesPricingOptions>("/pricing-options");
