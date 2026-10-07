"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { Badge } from "@vercentlabs/design-system";

import { formatMoney } from "@/shared/format/human";

import type { Item, ItemType, Lifecycle, TrackingMode } from "./api/items-api";

// The same items are opened from Inventory (Items: stock, units, tracking, valuation) and from Sales (Products & Services: selling,
// price lists, tax). The lens only decides where the screens live and what they lead with; the record is one.
export type ItemLens = "inventory" | "sales";
export const LENS = {
  inventory: { base: "/inventory/items", title: "Items", singular: "item", newLabel: "New Item", initialView: "all" },
  sales: { base: "/sales/products", title: "Products & Services", singular: "product", newLabel: "New Product or Service", initialView: "all" },
} as const;

const TYPE_TONE: Record<ItemType, "info" | "neutral" | "brand"> = { stock: "info", non_stock: "neutral", service: "brand" };
const TYPE_LABEL: Record<ItemType, string> = { stock: "Stock Item", non_stock: "Non-Stock Item", service: "Service" };
const LIFECYCLE_TONE: Record<Lifecycle, "warning" | "success" | "neutral"> = { draft: "warning", active: "success", inactive: "neutral" };
const LIFECYCLE_LABEL: Record<Lifecycle, string> = { draft: "Draft", active: "Active", inactive: "Inactive" };
const TRACKING_LABEL: Record<TrackingMode, string> = { none: "None", batch: "Batch", serial: "Serial" };

export const ItemTypeBadge = ({ item }: { item: Pick<Item, "type" | "isVariantTemplate"> }) =>
  item.isVariantTemplate ? <Badge tone="neutral">Variant template</Badge> : <Badge tone={TYPE_TONE[item.type]}>{TYPE_LABEL[item.type]}</Badge>;
export const LifecycleBadge = ({ status }: { status: Lifecycle }) => <Badge tone={LIFECYCLE_TONE[status]}>{LIFECYCLE_LABEL[status]}</Badge>;
export const trackingText = (mode: TrackingMode) => TRACKING_LABEL[mode] ?? mode;

// Copies the SKU to the clipboard; on a list row it does not open the row.
export function CopySkuButton({ sku }: { sku: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" aria-label={`Copy SKU ${sku}`} title="Copy SKU" className="rounded p-0.5 text-text-muted hover:text-text"
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard?.writeText(sku).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => undefined);
      }}>
      {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
    </button>
  );
}

// Why a search found the item, when it is not obvious from the row.
export const MATCH_LABELS: Record<string, string> = { barcode: "Matched barcode", part_number: "Matched part number", previous_sku: "Matched previous SKU", category: "Matched category" };

// The item's category from the top, each level opening that category.
export function CategoryPath({ item }: { item: Pick<Item, "categoryBreadcrumb" | "categoryName"> }) {
  if (!item.categoryBreadcrumb?.length) return <span className="text-text-muted">{item.categoryName ?? "None"}</span>;
  return (
    <nav aria-label="Category" className="inline-flex flex-wrap items-center gap-1">
      {item.categoryBreadcrumb.map((entry, index) => (
        <span key={entry.id} className="inline-flex items-center gap-1">
          {index > 0 && <span aria-hidden="true" className="text-text-subtle">›</span>}
          <Link className="text-brand hover:underline" href={`/inventory/item-categories/${entry.id}`}>{entry.name}</Link>
        </span>
      ))}
    </nav>
  );
}

export function ErrorBanner({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{message}</p>;
}

export const money = (value: number | null | undefined, currency = "INR") => (value === null || value === undefined ? "" : formatMoney(currency, value));
export const yesNo = (value: boolean) => (value ? "Yes" : "No");
export const quantity = (value: number | null | undefined, unit?: string | null) =>
  value === null || value === undefined ? "" : `${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 6 })}${unit ? ` ${unit}` : ""}`;
export const unitLine = (item: Item) =>
  [item.baseUom?.code, item.purchaseUomFactor && item.purchaseUomFactor !== 1 ? `bought per ${item.purchaseUom?.code} of ${item.purchaseUomFactor}` : null,
    item.salesUomFactor && item.salesUomFactor !== 1 ? `sold per ${item.salesUom?.code} of ${item.salesUomFactor}` : null].filter(Boolean).join(" · ");
export const taxLine = (item: Item) =>
  [item.hsnSacCode ? `${item.hsnSacLabel} ${item.hsnSacCode}` : null, item.taxCategoryName, item.gstRate !== null ? `GST ${item.gstRate}%` : null,
    item.cessRate ? `Cess ${item.cessRate}%` : null].filter(Boolean).join(" · ");
export const attributesText = (attributes: Record<string, string>) => Object.entries(attributes ?? {}).map(([name, value]) => `${name}: ${value}`).join(" · ");

export const NONE = "none";
export const withNone = (options: Array<{ value: string; label: string }>, label = "Not set") => [{ value: NONE, label }, ...options];
export const orNull = (value: string) => (value === NONE || value === "" ? null : value);
