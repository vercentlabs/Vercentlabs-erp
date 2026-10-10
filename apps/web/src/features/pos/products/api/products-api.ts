"use client";

// Browser client for Product Search under /api/pos/products (and the outlet's product settings). Which outlet and cart the search is for
// is resolved on the server; the screen passes the cart it is filling.
import type { PosBarcodeLookup, PosCart, PosOutletProductSettings, PosProductOutlet, PosProductResult } from "@vercentlabs/api";

import { post, request } from "@/features/pos/shared/http";

export type { PosBarcodeLookup, PosOutletProductSettings, PosProductOutlet, PosProductResult };
export type PosProductCategory = { id: string; name: string; parentId: string | null; sortOrder: number };
export type PosSearchPage = { products: PosProductResult[]; nextCursor: string | null; outlet: PosProductOutlet; unavailable?: { code: string; message: string } };

const query = (params: Record<string, string | null | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const searchProducts = (input: { cartId?: string | null; outletId?: string | null; q?: string; categoryId?: string | null; cursor?: string | null }, signal?: AbortSignal) =>
  request<PosSearchPage>(`/products/search${query({ cartId: input.cartId, outletId: input.outletId, q: input.q, categoryId: input.categoryId, cursor: input.cursor })}`, { signal });
export const lookupBarcode = (barcode: string, cartId?: string | null) =>
  request<PosBarcodeLookup>(`/products/barcode/${encodeURIComponent(barcode)}${query({ cartId })}`);
export const getProductDetails = (itemId: string, cartId?: string | null) =>
  request<{ product: PosProductResult; units: PosProductResult[]; variants: PosProductResult[] }>(`/products/${itemId}${query({ cartId })}`);
export const listProductCategories = (cartId?: string | null, outletId?: string | null) =>
  request<{ categories: PosProductCategory[] }>(`/products/categories${query({ cartId, outletId })}`);
export const getQuickProducts = (cartId?: string | null) => request<{ products: PosProductResult[] }>(`/products/quick${query({ cartId })}`);
export const addProductToCart = (cartId: string, input: { itemId: string; uomId?: string | null; quantity?: number; barcode?: string | null; idempotencyKey: string }) =>
  post<{ cart: PosCart; replayed: boolean }>(`/carts/${cartId}/items`, input);

export const getOutletProductSettings = (outletId: string) => request<PosOutletProductSettings>(`/outlets/${outletId}/products`);
export const updateOutletProductSettings = (outletId: string, input: Record<string, unknown>) =>
  request<PosOutletProductSettings>(`/outlets/${outletId}/products`, { method: "PATCH", body: JSON.stringify(input) });
export const setQuickProducts = (outletId: string, products: Array<{ itemId: string; uomId?: string | null }>) =>
  request<PosOutletProductSettings>(`/outlets/${outletId}/quick-products`, { method: "PUT", body: JSON.stringify({ products }) });

export const STOCK_LABEL: Record<NonNullable<PosProductResult["stockStatus"]>, string> = {
  in_stock: "In stock", low_stock: "Low stock", out_of_stock: "Out of stock", unavailable: "Unavailable", not_tracked: "Available",
};
export const STOCK_TONE: Record<NonNullable<PosProductResult["stockStatus"]>, "success" | "warning" | "danger" | "neutral"> = {
  in_stock: "success", low_stock: "warning", out_of_stock: "danger", unavailable: "neutral", not_tracked: "success",
};
