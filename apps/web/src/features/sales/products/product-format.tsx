"use client";

import { Badge } from "@vercentlabs/design-system";

import { formatMoney } from "@/shared/format/human";

import type { Product, ProductType } from "./api/products-api";

const TYPE_TONE: Record<ProductType, "info" | "neutral" | "brand"> = { stock: "info", non_stock: "neutral", service: "brand" };
const TYPE_LABEL: Record<ProductType, string> = { stock: "Stock Item", non_stock: "Non-Stock Item", service: "Service" };

export const ProductTypeBadge = ({ type }: { type: ProductType }) => <Badge tone={TYPE_TONE[type]}>{TYPE_LABEL[type]}</Badge>;
export const ProductStatusBadge = ({ active }: { active: boolean }) => <Badge tone={active ? "success" : "neutral"}>{active ? "Active" : "Inactive"}</Badge>;

export function ErrorBanner({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{message}</p>;
}

// Prices are in the organisation's base currency.
export const price = (value: number | null | undefined) => (value === null || value === undefined ? "" : formatMoney("INR", value));
export const yesNo = (value: boolean) => (value ? "Yes" : "No");
export const unitLine = (product: Product) =>
  [product.baseUom?.code, product.salesUomFactor && product.salesUomFactor !== 1 ? `sold per ${product.salesUom?.code} of ${product.salesUomFactor}` : null].filter(Boolean).join(" · ");
export const taxLine = (product: Product) =>
  [product.hsnSacCode ? `${product.hsnSacLabel} ${product.hsnSacCode}` : null, product.taxCategoryName, product.gstRate !== null ? `GST ${product.gstRate}%` : null,
    product.cessRate ? `Cess ${product.cessRate}%` : null].filter(Boolean).join(" · ");

export const NONE = "none";
export const withNone = (options: Array<{ value: string; label: string }>, label = "Not set") => [{ value: NONE, label }, ...options];
export const orNull = (value: string) => (value === NONE || value === "" ? null : value);
