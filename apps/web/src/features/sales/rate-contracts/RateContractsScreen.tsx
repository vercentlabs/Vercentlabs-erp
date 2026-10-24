"use client";

// Sales › Customers & prices › Rate Contracts (Sales audit): a customer's agreed rates over a period with the quantity it may draw. Orders
// for the customer are priced at the contract rate while quantity remains.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Trash2 } from "lucide-react";
import { Button, ComboBox, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, IconButton, NumberField, StatusBadge, TextField } from "@vercentlabs/design-system";

import { usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { post, request, SalesApiError } from "@/features/sales/shared/http";
import { searchSalesOptions } from "@/features/sales/quotations/api/quotations-api";

export type RateContract = {
  id: string; contractNumber: string; partyId: string; customerName: string | null; name: string; customerReference: string | null; currencyCode: string; validFrom: string; validTo: string;
  status: "draft" | "active" | "closed" | "cancelled"; statusLabel: string; notes: string | null;
  lines?: Array<{ id: string; itemId: string; itemName: string; itemCode: string; unit: string | null; rate: number; contractedQuantity: number; drawnQuantity: number; remainingQuantity: number }>;
};
export const TONE = { draft: "neutral", active: "success", closed: "info", cancelled: "danger" } as const;

export function RateContractsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "rate-contracts"), queryFn: () => request<{ contracts: RateContract[]; canManage: boolean }>("/rate-contracts") });
  const rows = useMemo(() => query.data?.contracts ?? [], [query.data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "validTo", desc: true }] });
  const columns = useMemo<ColumnDef<RateContract, unknown>[]>(() => [
    { id: "contractNumber", accessorKey: "contractNumber", header: "Contract", cell: ({ row }) => <span className="flex flex-col"><span className="font-medium text-text">{row.original.contractNumber}</span><span className="text-xs text-text-muted">{row.original.name}</span></span> },
    { id: "customerName", accessorKey: "customerName", header: "Customer" },
    { id: "validFrom", accessorKey: "validFrom", header: "From" },
    { id: "validTo", accessorKey: "validTo", header: "Until" },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={TONE[row.original.status]}>{row.original.statusLabel}</StatusBadge> },
  ], []);
  const can = query.data?.canManage;
  return (
    <>
      <EnterpriseListPage header={{
        title: "Customer rates",
        description: "Rates agreed with a customer for a period. Their orders use these rates while quantity remains.",
        primaryAction: can ? <Button variant="primary" onPress={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />New contract</Button> : undefined,
      }}>
        <EnterpriseDataGrid<RateContract>
          aria-label="Rate contracts" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
          state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
          loadingContent={<LoadingState label="Loading rate contracts" rows={5} />}
          errorContent={<ErrorState title="Could not load rate contracts" action={{ label: "Try again", onPress: () => void query.refetch() }} />}
          emptyContent={<EmptyState title="No rate contracts yet" description="Agree a customer's rates for the year, and its orders pick them up." action={can ? { label: "New contract", onPress: () => setCreating(true) } : undefined} />}
          {...paged.grid}
          onRowClick={(row) => router.push(`/sales/rate-contracts/${row.id}`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.contractNumber} · {row.name}</span><StatusBadge tone={TONE[row.status]}>{row.statusLabel}</StatusBadge></span>
              <span className="text-xs text-text-muted">{row.customerName} · {row.validFrom} to {row.validTo}</span>
            </div>
          )}
        />
      </EnterpriseListPage>
      {creating && <NewContractDialog onClose={() => setCreating(false)} onCreated={(id) => router.push(`/sales/rate-contracts/${id}`)} />}
    </>
  );
}

type LineDraft = { key: number; itemId: string | null; itemName: string | null; rate: number; quantity: number };
let next = 0;
const blank = (): LineDraft => ({ key: ++next, itemId: null, itemName: null, rate: NaN, quantity: NaN });

function Picker({ kind, label, value, valueLabel, onChange }: { kind: "customers" | "products"; label?: string; value: string | null; valueLabel: string | null; onChange: (id: string | null, name: string | null) => void }) {
  const workspace = useWorkspaceContext();
  const [text, setText] = useState("");
  const typed = text.trim() === (valueLabel ?? "") ? "" : text.trim();
  const search = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options-search", kind, typed, "contract"), queryFn: () => searchSalesOptions(kind, typed, false).then((r) => r.results) });
  const found = kind === "customers" ? (search.data?.parties ?? []).map((party) => ({ value: party.id, label: party.display_name })) : (search.data?.items ?? []).map((item) => ({ value: item.id, label: item.name }));
  const options = value && valueLabel && !found.some((option) => option.value === value) ? [{ value, label: valueLabel }, ...found] : found;
  return (
    <ComboBox label={label} aria-label={label ?? (kind === "customers" ? "Customer" : "Product")} options={options} selectedKey={value} onInputChange={setText} isLoading={search.isFetching}
      allowsEmptyCollection defaultFilter={() => true} placeholder={kind === "customers" ? "Search customers" : "Search products"}
      onSelectionChange={(key) => { const id = key ? String(key) : null; onChange(id, options.find((option) => option.value === id)?.label ?? null); }} />
  );
}

function NewContractDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [party, setParty] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([blank()]);
  const save = useMutation({
    mutationFn: () => post<{ contract: RateContract }>("/rate-contracts", { partyId: party.id ?? undefined, name: name.trim(), validFrom: from, validTo: to, customerReference: reference.trim() || null,
      lines: lines.filter((line) => line.itemId).map((line) => ({ itemId: line.itemId as string, rate: line.rate, contractedQuantity: line.quantity })) }),
    onSuccess: ({ contract }) => onCreated(contract.id),
  });
  const update = (key: number, patch: Partial<LineDraft>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="New rate contract" size="lg" description="Rates are per base unit, in the customer's currency. The contract prices orders once it is activated.">
      <div className="flex flex-col gap-4">
        {save.isError && <p role="alert" className="text-sm text-danger">{save.error instanceof SalesApiError ? save.error.message : "The contract could not be saved."}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Picker kind="customers" label="Customer" value={party.id} valueLabel={party.name} onChange={(id, label) => setParty({ id, name: label })} />
          <TextField label="Name" isRequired value={name} onChange={setName} placeholder="Annual pipes contract 2026-27" />
          <TextField label="From" type="date" isRequired value={from} onChange={setFrom} />
          <TextField label="Until" type="date" isRequired value={to} onChange={setTo} />
          <TextField className="sm:col-span-2" label="Customer's reference" value={reference} onChange={setReference} placeholder="Their contract or PO number" />
        </div>
        <div className="flex flex-col gap-2">
          {lines.map((line, index) => (
            <div key={line.key} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <Picker kind="products" label={index === 0 ? "Product" : undefined} value={line.itemId} valueLabel={line.itemName} onChange={(id, label) => update(line.key, { itemId: id, itemName: label })} />
              <NumberField aria-label={`Rate ${index + 1}`} label={index === 0 ? "Rate (per base unit)" : undefined} value={line.rate} onChange={(value) => update(line.key, { rate: value })} minValue={0} step={0.01} />
              <NumberField aria-label={`Quantity ${index + 1}`} label={index === 0 ? "Quantity (base units)" : undefined} value={line.quantity} onChange={(value) => update(line.key, { quantity: value })} minValue={0} />
              <IconButton aria-label={`Remove line ${index + 1}`} variant="ghost" isDisabled={lines.length === 1} onPress={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}>
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
          ))}
          <Button variant="ghost" size="compact" onPress={() => setLines((current) => [...current, blank()])}><Plus className="size-4" aria-hidden="true" />Add product</Button>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!party.id || !name.trim() || !from || !to} onPress={() => save.mutate()}>Save as draft</Button>
        </div>
      </div>
    </Dialog>
  );
}
