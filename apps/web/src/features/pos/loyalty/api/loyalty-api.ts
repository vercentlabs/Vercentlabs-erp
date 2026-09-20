"use client";

import type { PosCart, PosLoyaltyProgram, PosLoyaltyLedgerEntry, PosLoyaltyExpiryResult } from "@vercentlabs/api";

import { request, post, del } from "@/features/pos/shared/http";

// F306 Loyalty
export const redeemPosCartLoyaltyPoints = (id: string, points: number, expectedVersion?: number) =>
  post<{ cart: PosCart }>(`/carts/${id}/loyalty`, { points, expectedVersion });
export const removePosCartLoyaltyRedemption = (id: string, expectedVersion?: number) =>
  del<{ cart: PosCart }>(`/carts/${id}/loyalty${expectedVersion != null ? `?expectedVersion=${expectedVersion}` : ""}`);
export const getPosLoyaltyProgram = () => request<{ record: PosLoyaltyProgram | null }>("/loyalty/program");
export const upsertPosLoyaltyProgram = (input: Record<string, unknown>) => post<{ record: PosLoyaltyProgram }>("/loyalty/program", input);
export const setPosLoyaltyProgramActive = (active: boolean) => post<{ record: PosLoyaltyProgram }>("/loyalty/program/active", { active });
export const getPosCustomerLoyaltyBalance = (customerId: string) =>
  request<{ balance: { customerId: string; balance: string; updatedAt: string | null } }>(`/loyalty/customers/${customerId}`);
export const listPosCustomerLoyaltyLedger = (customerId: string, limit?: number) =>
  request<{ rows: PosLoyaltyLedgerEntry[] }>(`/loyalty/customers/${customerId}/ledger${limit ? `?limit=${limit}` : ""}`);
export const adjustPosCustomerLoyaltyBalance = (customerId: string, points: number, reason: string) =>
  post<{ balance: { customerId: string; balance: string } }>(`/loyalty/customers/${customerId}/adjust`, { points, reason });
// F306 -- retire points older than the program's expiry days. The cutoff is
// always derived server-side, so this takes no arguments.
export const expirePosLoyaltyPoints = () => post<{ result: PosLoyaltyExpiryResult }>("/loyalty/expire", {});
