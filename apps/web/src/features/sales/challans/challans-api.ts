"use client";

// Browser client for delivery challans without Stock (Sales audit).
import { post, request } from "@/features/sales/shared/http";

export type ChallanLine = { id: string; sequence: number; description: string; hsnSacCode: string | null; quantity: number; unit: string | null; unitValue: number; value: number };
export type Challan = {
  id: string; challanNumber: string; challanDate: string; purpose: string; purposeLabel: string; partyId: string | null; customer: { displayName?: string; gstin?: string };
  shipTo: { line1?: string; city?: string; state?: string }; salesOrderId: string | null; salesOrderNumber: string | null; vehicleNumber: string | null; transporterName: string | null;
  lrNumber: string | null; notes: string | null; totalValue: number; status: "draft" | "issued" | "cancelled"; statusLabel: string; cancelReason: string | null; lines?: ChallanLine[];
};
export type ChallanInput = {
  purpose?: string; partyId?: string | null; salesOrderId?: string | null; challanDate?: string | null; vehicleNumber?: string | null; transporterName?: string | null; lrNumber?: string | null;
  notes?: string | null; lines?: Array<{ description?: string | null; quantity: number; unitValue?: number | null; hsnSacCode?: string | null; unit?: string | null }>;
};

export const listChallans = (filters: { status?: string; search?: string } = {}) =>
  request<{ challans: Challan[]; purposes: Array<{ code: string; label: string }>; canManage: boolean }>(
    `/challans${filters.status || filters.search ? `?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value) as Array<[string, string]>)}` : ""}`);
export const getChallan = (id: string) => request<{ challan: Challan }>(`/challans/${id}`).then((response) => response.challan);
export const createChallan = (input: ChallanInput) => post<{ challan: Challan }>("/challans", input).then((response) => response.challan);
export const setChallanStatus = (id: string, action: "issue" | "cancel", reason?: string) => post<{ challan: Challan }>(`/challans/${id}`, { action, reason }).then((response) => response.challan);
export const challanPdfUrl = (id: string, inline = false) => `/api/documents/sales.challan/${id}/pdf${inline ? "?disposition=inline" : ""}`;
