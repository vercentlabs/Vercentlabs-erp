"use client";

import { request, post } from "@/features/pos/shared/http";

export type PosTerminal = { id: string; code: string; name: string; storeId?: string; store_id?: string; status: string };

export const listPosTerminals = () => request<{ rows: PosTerminal[] }>("/terminals");
export const createPosTerminal = (input: Record<string, unknown>) => post<{ terminal: PosTerminal }>("/terminals", input);
export const updatePosTerminalRecord = (id: string, input: Record<string, unknown>) =>
  request<{ terminal: PosTerminal }>(`/terminals/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const setPosTerminalStatusRecord = (id: string, status: "active" | "inactive" | "maintenance") =>
  post<{ terminal: PosTerminal }>(`/terminals/${id}/status`, { status });
