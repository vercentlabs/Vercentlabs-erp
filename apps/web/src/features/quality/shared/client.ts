"use client";

import { useQuery } from "@tanstack/react-query";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

export class QualityApiError extends Error {
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
  if (!response.ok || payload.ok === false) throw new QualityApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  return payload;
}

function call<T>(path: string, init?: RequestInit): Promise<T> {
  return fetch(`/api/quality${path}`, {
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

export type QualityOptions = Partial<Record<OptionKey, Array<{ id: string; code: string; name: string }>>>;
type OptionKey = import("@/features/quality/shared/FieldInput").OptionSource;

export function useQualityOptions() {
  const workspace = useWorkspaceContext();
  return useQuery({ queryKey: scopedQueryKey(workspace, "quality", "options"), queryFn: () => readView<{ options: QualityOptions }>("options").then((r) => r.options), staleTime: 15_000 });
}
