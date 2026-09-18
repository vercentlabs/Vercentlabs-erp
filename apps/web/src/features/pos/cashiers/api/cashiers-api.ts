"use client";

import { request, post } from "@/features/pos/shared/http";

export type PosEligibleCashier = { id: string; fullName: string; email: string; roleSlugs: string[]; assignedStoreIds: string[] };
export const listPosEligibleCashiers = () => request<{ rows: PosEligibleCashier[] }>("/cashiers");

// F270/F271: terminalId null/undefined = a store-wide grant (every
// terminal at the store); a real terminalId = a narrower, terminal-
// specific grant. See migration 128.
export type PosStoreAccessGrant = { id: string; userId: string; storeId: string; terminalId: string | null; terminalName: string | null; fullName: string; email: string; createdAt: string };
export const listPosStoreAccess = (storeId?: string) => request<{ rows: PosStoreAccessGrant[] }>(`/store-access${storeId ? `?storeId=${storeId}` : ""}`);
export const grantPosStoreAccess = (userId: string, storeId: string, terminalId?: string | null) =>
  post<{ grant: PosStoreAccessGrant }>("/store-access", { userId, storeId, terminalId: terminalId || undefined });
export const revokePosStoreAccess = (userId: string, storeId: string, terminalId?: string | null) =>
  request<{ revoked: true }>(`/store-access?userId=${userId}&storeId=${storeId}${terminalId ? `&terminalId=${terminalId}` : ""}`, { method: "DELETE" });
