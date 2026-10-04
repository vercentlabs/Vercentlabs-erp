"use client";

import { Badge } from "@vercentlabs/design-system";

import { countryName } from "@/shared/format/human";

import type { CustomerAddress, CustomerStatus } from "./api/customers-api";

const STATUS_TONE: Record<CustomerStatus, "success" | "neutral" | "danger"> = { active: "success", inactive: "neutral", blocked: "danger" };
const STATUS_LABEL: Record<CustomerStatus, string> = { active: "Active", inactive: "Inactive", blocked: "Blocked" };

export function CustomerStatusBadge({ status }: { status: CustomerStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export function ErrorBanner({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{message}</p>;
}

export const cityState = (row: { city: string | null; state: string | null }) => [row.city, row.state].filter(Boolean).join(", ");

export function addressLines(address: Pick<CustomerAddress, "line1" | "line2" | "city" | "district" | "state" | "postalCode" | "countryCode">) {
  return [
    address.line1,
    address.line2,
    [address.city, address.district && address.district !== address.city ? address.district : null].filter(Boolean).join(", "),
    [address.state, address.postalCode].filter(Boolean).join(" "),
    address.countryCode ? countryName(address.countryCode) : null,
  ].filter(Boolean) as string[];
}

export const NONE = "none";
export const withNone = (options: Array<{ value: string; label: string }>, label = "Not set") => [{ value: NONE, label }, ...options];
export const orNull = (value: string) => (value === NONE || value === "" ? null : value);
