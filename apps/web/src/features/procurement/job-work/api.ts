"use client";

import { post, request } from "@/features/procurement/shared/http";

// Job work and Form ITC-04 (Procurement report Phase 3).
export type JobWorkLine = { id: string; sequence: number; itemId: string | null; description: string; hsnSacCode: string | null; unit: string | null; quantity: number; unitValue: number;
  value: number; processed: number; returned: number; waste: number; pending: number };
export type JobWorkReturn = { id: string; lineId: string; returnDate: string; kind: "processed" | "unprocessed" | "waste"; quantity: number; challanNumber: string | null;
  challanDate: string | null; goodsReceiptId: string | null; goodsReceiptNumber: string | null; notes: string | null };
export type JobWork = {
  id: string; number: string; status: "draft" | "sent" | "partly_returned" | "completed" | "cancelled"; statusLabel: string; supplierId: string;
  jobWorker: { name?: string; gstin?: string | null; stateCode?: string | null }; sentDate: string | null; dueDate: string | null; goodsKind: "inputs" | "capital_goods";
  natureOfJob: string | null; warehouseId: string | null; warehouseName: string | null; purchaseOrderId: string | null; purchaseOrderNumber: string | null; vehicleNumber: string | null;
  notes: string | null; totalValue: number; stockMoved: boolean; overdue: boolean; open?: boolean; lines?: JobWorkLine[]; returns?: JobWorkReturn[];
  actions?: { send: boolean; recordReturn: boolean; cancel: boolean };
};
export type JobWorkInput = {
  supplierId: string; warehouseId?: string; goodsKind: string; natureOfJob?: string; purchaseOrderId?: string; vehicleNumber?: string; notes?: string;
  lines: Array<{ itemId?: string; description?: string; quantity: string; unitValue?: string; unit?: string; hsnSacCode?: string }>;
};

export const listJobWork = (view: string) =>
  request<{ rows: JobWork[]; goods: Array<{ code: string; label: string }>; canManage: boolean }>(`/job-work?view=${encodeURIComponent(view)}`);
export const getJobWork = (id: string) => request<{ jobWork: JobWork }>(`/job-work/${id}`).then((result) => result.jobWork);
export const createJobWork = (input: JobWorkInput) => post<{ result: JobWork }>("/job-work", input).then((result) => result.result);
export const jobWorkAction = (id: string, action: "send" | "cancel" | "returns", input: Record<string, unknown> = {}) =>
  post<{ result: JobWork }>(`/job-work/${id}/${action}`, input).then((result) => result.result);
export const itc04Url = (from: string, to: string) => `/api/procurement/job-work/itc-04?from=${from}&to=${to}`;
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
