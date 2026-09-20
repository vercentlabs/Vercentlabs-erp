"use client";

import { useQuery } from "@tanstack/react-query";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

export class MfgApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new MfgApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  return payload;
}

function call<T>(path: string, init?: RequestInit): Promise<T> {
  return fetch(`/api/manufacturing${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    ...init,
  }).then(parse<T>);
}

export const qs = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = { id: string } & Record<string, any>;

export const readView = <T = { rows: Row[] }>(kind: string, params: Record<string, string | undefined> = {}) => call<T>(`/view/${kind}${qs(params)}`);
export const act = <T = { record: Row }>(action: string, input: Record<string, unknown> = {}) => call<T>(`/actions/${action}`, { method: "POST", body: JSON.stringify(input) });

export type MfgOptions = {
  items: Array<{ id: string; code: string; name: string }>;
  warehouses: Array<{ id: string; code: string; name: string }>;
  uoms: Array<{ id: string; code: string; name: string }>;
  boms: Array<{ id: string; code: string; name: string; version: number; item_id: string }>;
  routings: Array<{ id: string; code: string; name: string }>;
  workCenters: Array<{ id: string; code: string; name: string }>;
  workOrders: Array<{ id: string; code: string; name: string }>;
  calendars: Array<{ id: string; code: string; name: string }>;
  salesOrders: Array<{ id: string; code: string; name: string }>;
  assets: Array<{ id: string; code: string; name: string }>;
};

export function useMfgOptions() {
  const workspace = useWorkspaceContext();
  return useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "options"), queryFn: () => readView<{ options: MfgOptions }>("options").then((r) => r.options), staleTime: 15_000 });
}
