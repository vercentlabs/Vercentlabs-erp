"use client";

import { useQuery } from "@tanstack/react-query";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

export class InvApiError extends Error {
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
  if (!response.ok || payload.ok === false) throw new InvApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  return payload;
}

function call<T>(path: string, init?: RequestInit): Promise<T> {
  return fetch(`/api/inventory${path}`, {
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

export const listMaster = (resource: string, params: Record<string, string | undefined> = {}) => call<{ rows: Row[]; total: number }>(`/master/${resource}${qs(params)}`);
export const createMaster = (resource: string, input: Record<string, unknown>) => call<{ record: Row }>(`/master/${resource}`, { method: "POST", body: JSON.stringify(input) });
export const updateMaster = (resource: string, id: string, input: Record<string, unknown>) => call<{ record: Row }>(`/master/${resource}/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const readStock = <T = { rows: Row[] }>(kind: string, params: Record<string, string | undefined> = {}) => call<T>(`/stock/${kind}${qs(params)}`);
export const act = <T = { record: Row }>(action: string, input: Record<string, unknown> = {}) => call<T>(`/actions/${action}`, { method: "POST", body: JSON.stringify(input) });

export type InvOptions = {
  items: Array<{ id: string; code: string; name: string }>;
  warehouses: Array<{ id: string; code: string; name: string }>;
  locations: Array<{ id: string; code: string; name: string; warehouse_id: string }>;
  batches: Array<{ id: string; code: string; name: string; item_id: string }>;
  uoms: Array<{ id: string; code: string; name: string }>;
  groups: Array<{ id: string; code: string; name: string }>;
  taxCategories: Array<{ id: string; code: string; name: string }>;
};

// Names for pickers, and for the ids stored on documents.
export function useInvOptions() {
  const workspace = useWorkspaceContext();
  return useQuery({ queryKey: scopedQueryKey(workspace, "inventory", "options"), queryFn: () => readStock<{ options: InvOptions }>("options").then((r) => r.options), staleTime: 30_000 });
}
