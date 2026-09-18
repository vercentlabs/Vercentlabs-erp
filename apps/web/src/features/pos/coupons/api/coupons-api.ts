"use client";

import type { PosCoupon } from "@vercentlabs/api";

import { request, post } from "@/features/pos/shared/http";

export const listPosCoupons = (status?: string) => request<{ rows: PosCoupon[] }>(`/coupons${status ? `?status=${status}` : ""}`);
export const createPosCoupon = (input: Record<string, unknown>) => post<{ record: PosCoupon }>("/coupons", input);
export const updatePosCoupon = (id: string, input: Record<string, unknown>) =>
  request<{ record: PosCoupon }>(`/coupons/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const setPosCouponActive = (id: string, active: boolean) => post<{ record: PosCoupon }>(`/coupons/${id}/active`, { active });
