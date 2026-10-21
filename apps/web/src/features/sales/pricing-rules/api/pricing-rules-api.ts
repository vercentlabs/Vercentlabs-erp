"use client";

// Browser client for Sales › Schemes & Rates under /api/sales/pricing-rules (Sales audit M3).
import { post, request } from "@/features/sales/shared/http";

export type PricingRuleType = "fixed_rate" | "discount_percent" | "discount_amount" | "free_goods";
export type PricingRule = {
  id: string; code: string; name: string; priority: number; status: "active" | "inactive"; isActive: boolean; isCurrent: boolean;
  adjustmentType: PricingRuleType; typeLabel: string; adjustmentValue: number;
  partyId: string | null; partyName: string | null; partyType: string | null;
  itemId: string | null; itemName: string | null; itemCode: string | null; itemGroupId: string | null; itemGroupName: string | null;
  priceListId: string | null; priceListName: string | null; minimumQuantity: number; freeItemId: string | null; freeItemName: string | null; freeQuantity: number | null;
  validFrom: string | null; validTo: string | null; reason: string | null; who: string; what: string; summary: string; usedOnLines: number; updatedAt: string;
};
export type PricingRuleInput = Partial<{
  code: string; name: string; adjustmentType: PricingRuleType; adjustmentValue: number; partyId: string | null; partyType: string | null; itemId: string | null;
  itemGroupId: string | null; priceListId: string | null; minimumQuantity: number; freeItemId: string | null; freeQuantity: number | null; validFrom: string | null;
  validTo: string | null; reason: string | null; priority: number;
}>;

const query = (params: object) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const listPricingRules = (filters: { search?: string; status?: string; type?: string } = {}) =>
  request<{ rules: PricingRule[]; types: Array<{ code: PricingRuleType; label: string }>; capabilities: { view: boolean; manage: boolean } }>(`/pricing-rules${query(filters)}`);
export const createPricingRule = (input: PricingRuleInput) => post<{ rule: PricingRule }>("/pricing-rules", input).then((response) => response.rule);
export const updatePricingRule = (id: string, input: PricingRuleInput) =>
  request<{ rule: PricingRule }>(`/pricing-rules/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then((response) => response.rule);
export const setPricingRuleStatus = (id: string, action: "activate" | "deactivate" | "delete") => post<{ result: unknown }>(`/pricing-rules/${id}/status`, { action });
