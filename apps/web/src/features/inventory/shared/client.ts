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
  if (!response.ok || payload.ok === false)
    throw new InvApiError(
      payload.message || "The request could not be completed.",
      response.status,
      payload.code,
    );
  return payload;
}

function call<T>(path: string, init?: RequestInit): Promise<T> {
  return fetch(`/api/inventory${path}`, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    ...init,
  }).then(parse<T>);
}

const qs = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = { id: string } & Record<string, any>;

export const readStock = <T = { rows: Row[] }>(
  kind: string,
  params: Record<string, string | undefined> = {},
) => call<T>(`/stock/${kind}${qs(params)}`);
export const act = <T = { record: Row }>(
  action: string,
  input: Record<string, unknown> = {},
) =>
  call<T>(`/actions/${action}`, {
    method: "POST",
    body: JSON.stringify(input),
  });

export type InvOptions = {
  items: Array<{ id: string; code: string; name: string; uom_id?: string; tracking_type?: "none" | "batch" | "serial"; requires_expiry_date?: boolean; base_uom?: string | null; units?: Array<{ uomId: string; code: string; factor: string; decimals: number }> }>;
  warehouses: Array<{ id: string; code: string; name: string }>;
  locations: Array<{
    id: string;
    code: string;
    name: string;
    warehouse_id: string;
  }>;
  batches: Array<{ id: string; code: string; name: string; item_id: string }>;
  // The user's preferred warehouse, else the company default: where new stock documents start.
  defaultWarehouseId: string | null;
  // Per item and warehouse: on hand and what is available now (eligible on hand less reservations), in the base unit.
  availability: Array<{ item_id: string; warehouse_id: string; on_hand: number; available: number }>;
};

// Names for pickers, and for the ids stored on documents.
export function useInvOptions() {
  const workspace = useWorkspaceContext();
  return useQuery({
    queryKey: scopedQueryKey(workspace, "inventory", "options"),
    queryFn: () =>
      readStock<{ options: InvOptions }>("options").then((r) => r.options),
    staleTime: 30_000,
  });
}
