"use client";

import type { PosPromotion } from "@vercentlabs/api";

import { request, post } from "@/features/pos/shared/http";

export const listPosPromotions = (status?: string) => request<{ rows: PosPromotion[] }>(`/promotions${status ? `?status=${status}` : ""}`);
export const createPosPromotion = (input: Record<string, unknown>) => post<{ record: PosPromotion }>("/promotions", input);
export const updatePosPromotion = (id: string, input: Record<string, unknown>) =>
  request<{ record: PosPromotion }>(`/promotions/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const setPosPromotionActive = (id: string, active: boolean) => post<{ record: PosPromotion }>(`/promotions/${id}/active`, { active });
