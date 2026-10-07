"use client";

import { useQuery } from "@tanstack/react-query";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  getOptions,
  type ProcOptions,
} from "@/features/procurement/shared/api";

export type Lookup = {
  options: ProcOptions | undefined;
  supplier: (id: unknown) => string;
  item: (id: unknown) => string;
  warehouse: (id: unknown) => string;
  category: (id: unknown) => string;
};

// Names for the ids stored on documents. Documents keep ids (the source of
// truth); the label is looked up for display and falls back to a dash.
export function useLookup(): Lookup {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "procurement", "options"),
    queryFn: getOptions,
  });
  const o = query.data;
  const find = <T extends { id: string }>(
    rows: T[] | undefined,
    id: unknown,
    label: (row: T) => string,
  ) => {
    const row = rows?.find((candidate) => candidate.id === id);
    return row ? label(row) : id ? "…" : "—";
  };
  return {
    options: o,
    supplier: (id) => find(o?.suppliers, id, (r) => r.label),
    item: (id) => find(o?.items, id, (r) => `${r.name} (${r.code})`),
    warehouse: (id) => find(o?.warehouses, id, (r) => r.name),
    category: (id) => find(o?.categories, id, (r) => r.label),
  };
}
