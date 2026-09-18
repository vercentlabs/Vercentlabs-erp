"use client";

import { request, post } from "@/features/pos/shared/http";

export type PosEligibleCashier = { id: string; fullName: string; email: string; roleSlugs: string[]; assignedStoreIds: string[] };
export const listPosEligibleCashiers = () => request<{ rows: PosEligibleCashier[] }>("/cashiers");

export type PosStoreAccessGrant = { id: string; userId: string; storeId: string; fullName: string; email: string; createdAt: string };
export const listPosStoreAccess = (storeId?: string) => request<{ rows: PosStoreAccessGrant[] }>(`/store-access${storeId ? `?storeId=${storeId}` : ""}`);
export const grantPosStoreAccess = (userId: string, storeId: string) => post<{ grant: PosStoreAccessGrant }>("/store-access", { userId, storeId });
export const revokePosStoreAccess = (userId: string, storeId: string) =>
  request<{ revoked: true }>(`/store-access?userId=${userId}&storeId=${storeId}`, { method: "DELETE" });
