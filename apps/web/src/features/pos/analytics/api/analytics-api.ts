"use client";

import { request } from "@/features/pos/shared/http";

export type PosAnalyticsSummary = {
  saleCount: number;
  grossSales: string;
  netSales: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  averageOrderValue: string;
};
export type PosAnalyticsBreakdownRow = { store_id?: string; store_name?: string; terminal_id?: string; terminal_name?: string; cashier_id?: string; cashier_name?: string; sale_count: number; grand_total: string };
export type PosAnalyticsProductRow = { item_id: string; item_name: string | null; category_name: string | null; quantity_sold: string; revenue: string };
export type PosAnalyticsTenderRow = { payment_method: string; payment_count: number; amount: string };
export type PosSalesAnalytics = {
  summary: PosAnalyticsSummary;
  byStore: PosAnalyticsBreakdownRow[];
  byTerminal: PosAnalyticsBreakdownRow[];
  byCashier: PosAnalyticsBreakdownRow[];
  byProduct: PosAnalyticsProductRow[];
  tenderBreakdown: PosAnalyticsTenderRow[];
  discounts: { promotionTotal: string; couponTotal: string; otherTotal: string };
  returns: { count: number; refundTotal: string };
  cashVariance: { reportCount: number; varianceTotal: string };
  reconciliationExceptions: { count: number };
  offlineSyncExceptions: { pending: number; resolved: number };
  accountingPostingStatus: Record<string, number>;
  loyalty: { pointsEarned: string; pointsRedeemed: string; redeemAmount: string };
  margin: { costedLineCount: number; netRevenue: string; cogsTotal: string; grossMargin: string } | null;
};

// F307
export const getPosSalesAnalytics = (filters: { dateFrom: string; dateTo: string; storeId?: string; terminalId?: string; cashierId?: string }) => {
  const params = new URLSearchParams();
  params.set("dateFrom", filters.dateFrom);
  params.set("dateTo", filters.dateTo);
  if (filters.storeId) params.set("storeId", filters.storeId);
  if (filters.terminalId) params.set("terminalId", filters.terminalId);
  if (filters.cashierId) params.set("cashierId", filters.cashierId);
  return request<PosSalesAnalytics>(`/analytics?${params}`);
};
