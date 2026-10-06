"use client";

import { StatusBadge } from "@vercentlabs/design-system";

import type { Supplier, SupplierStatus } from "./api/suppliers-api";

const TONES: Record<SupplierStatus, "success" | "neutral" | "danger"> = { active: "success", inactive: "neutral", blocked: "danger" };
const LABELS: Record<SupplierStatus, string> = { active: "Active", inactive: "Inactive", blocked: "Blocked" };

export function SupplierStatusBadge({ status }: { status: SupplierStatus }) {
  return <StatusBadge tone={TONES[status] ?? "neutral"}>{LABELS[status] ?? status}</StatusBadge>;
}

// "Pune, Maharashtra" from the supplier's default location, else its registered state.
export const placeOf = (supplier: Pick<Supplier, "primaryAddress" | "registeredStateName">) =>
  [supplier.primaryAddress?.city, supplier.primaryAddress?.state ?? supplier.registeredStateName].filter(Boolean).join(", ");

export const formatAddress = (address: { line1: string; line2?: string | null; city: string; state?: string | null; postalCode?: string | null; countryCode?: string | null }) =>
  [address.line1, address.line2, [address.city, address.state, address.postalCode].filter(Boolean).join(" "), address.countryCode && address.countryCode !== "IN" ? address.countryCode : null]
    .filter(Boolean).join(", ");
