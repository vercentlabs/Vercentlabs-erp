"use client";

import { AssetApiError, qs } from "../register/register-api";

// Assets — the client of /api/assets/overview: the dashboard, the exceptions and reconciliation center, and asset search.
async function call<T>(path: string): Promise<T> {
  const response = await fetch(`/api/assets/overview${path}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AssetApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload as T;
}
export type Queue = { group: string; label: string; value: number; href: string; tone: "neutral" | "warning" | "danger" };
export type Dashboard = {
  register: { counts: Record<string, number>; byStatus: Array<{ status: string; label: string; count: number }>; byCategory: Array<{ name: string; n: number }>; exceptions: number; statusExceptions: number };
  queues: Queue[]; recent: Array<{ asset: string; what: string; at: string; href: string }>; actions: Array<{ label: string; href: string }>; team: boolean; asOf: string };
export type ControlCenter = { areas: Array<{ area: string; count: number; items: Array<{ label: string; subject: string | null; detail: string | null; href: string; source: string }> }>; total: number };
export type SearchHit = { id: string; asset: string; lifecycle: string; serial: string | null; tag: string | null; matched: string; href: string };
export const getDashboard = () => call<Dashboard>("");
export const getControlCenter = () => call<ControlCenter>("/exceptions");
export const searchAssets = (q: string) => call<{ rows: SearchHit[] }>(`/search${qs({ q })}`).then((r) => r.rows);
