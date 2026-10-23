"use client";

// Search-as-you-type supplier or product chooser for Procurement forms and list filters (Procurement plan Phase 0, bug 6): a company
// with thousands of suppliers or items finds one by typing its name, number, GSTIN (suppliers) or name, code, SKU, barcode, HSN (items)
// instead of a list that stopped at the first 2,000 or 5,000. `known` is what the screen already holds (the first page from its options
// and anything picked), shown while nothing is typed; `onPick` gets the row so the screen can keep it (useKnownRows). A value that is
// not among them (a filter from the address, a saved view) is fetched by id so its name shows. A supplier's label carries its GSTIN and
// MSME status, an item's its last purchase price from `supplierId`. `anyLabel` adds a "no filter" first option.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ComboBox } from "@vercentlabs/design-system";

import { useQuickCreate } from "@/shell/pickers/useQuickCreate";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { searchProcurementOptions, type ProcurementPickRow } from "./api";

export const ANY_PICK = "any";
type Kind = "suppliers" | "products";
// Rows as the different option endpoints return them (vendor credits name the number `number`).
type KnownRow = { id: string; name: string; supplier_number?: string; number?: string } & Partial<ProcurementPickRow>;

const asPickRow = (row: KnownRow): ProcurementPickRow => ({ ...row, supplier_number: row.supplier_number ?? row.number, label: row.label ?? row.name });

export function pickLabel(kind: Kind, row: ProcurementPickRow) {
  if (kind === "suppliers")
    return [`${row.name}${row.supplier_number ? ` · ${row.supplier_number}` : ""}`, row.gstin, row.msme ? "MSME" : null, row.status && row.status !== "active" ? row.status : null]
      .filter(Boolean).join(" · ");
  const price = row.last_purchase_price ? Number(row.last_purchase_price) : null;
  return `${row.name}${row.code ? ` (${row.code})` : ""}${price ? ` · last ₹${price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : ""}`;
}

// The row behind an id: from what the screen knows, else fetched once by id (a filter from the address, a saved view).
export function useResolvedRow(kind: Kind, id: string | null | undefined, known: KnownRow[]) {
  const workspace = useWorkspaceContext();
  const held = id ? known.find((row) => row.id === id) : undefined;
  const wanted = Boolean(id && id !== ANY_PICK && !held);
  const fetched = useQuery({
    queryKey: scopedQueryKey(workspace, "procurement", "pick-by-id", kind, id ?? ""),
    queryFn: () => searchProcurementOptions({ kind, ids: [id!] }),
    enabled: wanted,
    staleTime: 5 * 60_000,
  });
  if (held) return asPickRow(held);
  const rows = (kind === "suppliers" ? fetched.data?.suppliers : fetched.data?.products) ?? [];
  return rows.find((row) => row.id === id) ?? null;
}

export function ProcurementSearchPicker(props: {
  kind: Kind;
  value: string | null;
  known: KnownRow[];
  onPick: (id: string, row: ProcurementPickRow | null) => void;
  label?: string;
  "aria-label"?: string;
  supplierId?: string | null;
  activeOnly?: boolean;
  anyLabel?: string;
  size?: "compact" | "standard";
  isRequired?: boolean;
  isDisabled?: boolean;
  placeholder?: string;
  description?: React.ReactNode;
  className?: string;
  /** Create where you are: a document's supplier or product picker offers "+ Create" (a list filter, with anyLabel, never does). */
  creatable?: boolean;
}) {
  const { kind, value, onPick, anyLabel } = props;
  const workspace = useWorkspaceContext();
  const [text, setText] = useState("");
  const usable = (row: ProcurementPickRow) => !props.activeOnly || kind !== "suppliers" || !row.status || row.status === "active" || row.id === value;
  const known = props.known.map(asPickRow).filter(usable);
  const chosen = useResolvedRow(kind, value, props.known);
  // The box shows the chosen row's label once picked; that is not a search.
  const typed = (chosen && text.trim() === pickLabel(kind, chosen)) || text.trim() === anyLabel ? "" : text.trim();
  const search = useQuery({
    queryKey: scopedQueryKey(workspace, "procurement", "pick", kind, typed, props.supplierId ?? "", props.activeOnly ? "active" : ""),
    queryFn: () => searchProcurementOptions({ kind, search: typed, supplierId: props.supplierId ?? null, activeOnly: Boolean(props.activeOnly) }),
    enabled: typed.length > 0,
    staleTime: 15_000,
  });
  const found = typed && search.data ? (kind === "suppliers" ? search.data.suppliers : search.data.products) ?? [] : null;
  const rows = merged(found ?? known, chosen ? [chosen] : []);
  const options = [...(anyLabel ? [{ value: ANY_PICK, label: anyLabel }] : []), ...rows.map((row) => ({ value: row.id, label: pickLabel(kind, row) }))];
  // The new supplier or item is read back in Procurement's own terms (GSTIN, MSME, last price) and picked like any other.
  const quickCreate = useQuickCreate(kind === "suppliers" ? "supplier" : "item", {
    prefill: kind === "products" ? { isPurchasable: true, isSellable: false } : undefined,
    onCreated: async (record) => {
      const found = await searchProcurementOptions({ kind, ids: [record.id] }).catch(() => null);
      const row = (kind === "suppliers" ? found?.suppliers : found?.products)?.find((entry) => entry.id === record.id) ?? null;
      onPick(record.id, row);
    },
  });
  const creatable = (props.creatable ?? !anyLabel) && quickCreate.canCreate;
  return (
    <>
    <ComboBox
      className={props.className}
      size={props.size}
      label={props.label}
      aria-label={props["aria-label"]}
      description={props.description}
      isRequired={props.isRequired}
      isDisabled={props.isDisabled}
      placeholder={props.placeholder ?? (kind === "suppliers" ? "Search suppliers" : "Search products")}
      options={options}
      selectedKey={value || (anyLabel ? ANY_PICK : null)}
      onSelectionChange={(key) => {
        if (!key) return;
        const id = String(key);
        onPick(id, id === ANY_PICK ? null : rows.find((row) => row.id === id) ?? null);
      }}
      onInputChange={setText}
      isLoading={search.isFetching}
      emptyMessage={search.isError ? "Search failed. Try again." : kind === "suppliers" ? "No matching suppliers" : "No matching products"}
      allowsEmptyCollection
      // The server already matched (by GSTIN, barcode, HSN… too); the box must not filter its answer again by the label.
      defaultFilter={() => true}
      onCreate={creatable ? quickCreate.open : undefined}
      createLabel={(text) => (text ? `Create ${quickCreate.noun} "${text}"` : `Create a new ${quickCreate.noun}`)}
    />
    {quickCreate.drawer}
    </>
  );
}

// A list's supplier filter: the picker with an "Any supplier" first option; `value` and `onChange` use "" for no filter.
export function SupplierFilter({ value, onChange, known, label = "Supplier", anyLabel = "Any supplier", className }: {
  value: string; onChange: (id: string) => void; known: KnownRow[]; label?: string; anyLabel?: string; className?: string;
}) {
  return (
    <ProcurementSearchPicker kind="suppliers" label={label} anyLabel={anyLabel} size="compact" className={className ?? "w-full sm:w-64"} known={known}
      value={value && value !== ANY_PICK && value !== "all" ? value : null} onPick={(id) => onChange(id === ANY_PICK ? "" : id)} />
  );
}

function merged<T extends { id: string }>(list: T[], extra: T[]) {
  const seen = new Set(list.map((row) => row.id));
  return [...list, ...extra.filter((row) => !seen.has(row.id))];
}

// The rows a screen holds: its options' first page plus every row picked since, so lookups by id keep working after a search.
export function useKnownRows<T extends { id: string }>(initial: T[]) {
  const [picked, setPicked] = useState<T[]>([]);
  const rows = merged(initial, picked);
  const keep = (row: T | null) => {
    if (row && !rows.some((entry) => entry.id === row.id)) setPicked((current) => [...current, row]);
  };
  return [rows, keep] as const;
}
