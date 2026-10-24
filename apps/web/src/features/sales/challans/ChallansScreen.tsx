"use client";

// Sales › Deliver › Delivery Challans (without Stock): goods sent ahead of the invoice, on approval, for job work, to a branch or an
// exhibition. A challan from a confirmed order is made from the order's page; a free one here.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Trash2 } from "lucide-react";
import { Button, ComboBox, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, IconButton, NoResultsState, NumberField, SearchField, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { SalesApiError } from "@/features/sales/shared/http";
import { money } from "@/features/sales/shared/format";
import { searchSalesOptions } from "@/features/sales/quotations/api/quotations-api";

import { createChallan, listChallans, type Challan } from "./challans-api";

const ANY = "any";
const VIEWS = [{ id: ANY, label: "All" }, { id: "draft", label: "Draft" }, { id: "issued", label: "Issued" }, { id: "cancelled", label: "Cancelled" }];
const TONE = { draft: "neutral", issued: "success", cancelled: "danger" } as const;

export function ChallansScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [status, setStatus] = useState(ANY);
  const [creating, setCreating] = useState(false);
  const filters = { search: submitted || undefined, status: status === ANY ? undefined : status };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "challans", filters), queryFn: () => listChallans(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => query.data?.challans ?? [], [query.data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "challanDate", desc: true }] });
  const columns = useMemo<ColumnDef<Challan, unknown>[]>(() => [
    { id: "challanNumber", accessorKey: "challanNumber", header: "Challan", cell: ({ row }) => <span className="font-medium text-text">{row.original.challanNumber}</span> },
    { id: "challanDate", accessorKey: "challanDate", header: "Date" },
    { id: "customer", header: "Ship to", enableSorting: false, cell: ({ row }) => row.original.customer.displayName ?? "Own branch" },
    { id: "purposeLabel", accessorKey: "purposeLabel", header: "Why" },
    { id: "salesOrderNumber", accessorKey: "salesOrderNumber", header: "Sales order", cell: ({ row }) => row.original.salesOrderNumber ?? "" },
    { id: "totalValue", accessorKey: "totalValue", header: "Value", cell: ({ row }) => <span className="tabular-nums">{money("INR", row.original.totalValue)}</span> },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={TONE[row.original.status]}>{row.original.statusLabel}</StatusBadge> },
  ], []);
  const can = query.data?.canManage;
  return (
    <>
      <EnterpriseListPage
        header={{
          title: "Delivery Challans",
          description: "Goods sent without a delivery: before billing, on approval, for job work, to a branch or exhibition.",
          primaryAction: can ? <Button variant="primary" onPress={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />New challan</Button> : undefined,
        }}
        savedViews={{ views: VIEWS, activeViewId: status, onSelect: (id) => { setStatus(id); paged.resetPage(); } }}
        actionBar={{ start: <SearchField aria-label="Search challans" placeholder="Search number, ship to or order" className="w-full sm:w-80" value={search} onChange={setSearch} /> }}
      >
        <EnterpriseDataGrid<Challan>
          aria-label="Delivery challans" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
          state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (submitted || status !== ANY ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading challans" rows={6} />}
          errorContent={<ErrorState title="Could not load challans" action={{ label: "Try again", onPress: () => void query.refetch() }} />}
          emptyContent={<EmptyState title="No challans yet" description="Send goods on a challan when they move without a delivery." action={can ? { label: "New challan", onPress: () => setCreating(true) } : undefined} />}
          noResultsContent={<NoResultsState title="No challans match" description="Try another view or search." />}
          {...paged.grid}
          onRowClick={(row) => router.push(`/sales/challans/${row.id}`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.challanNumber}</span><StatusBadge tone={TONE[row.status]}>{row.statusLabel}</StatusBadge></span>
              <span className="text-xs text-text-muted">{row.customer.displayName ?? "Own branch"} · {row.purposeLabel} · {money("INR", row.totalValue)}</span>
            </div>
          )}
        />
      </EnterpriseListPage>
      {creating && query.data && <NewChallanDialog purposes={query.data.purposes} onClose={() => setCreating(false)} onCreated={(id) => router.push(`/sales/challans/${id}`)} />}
    </>
  );
}

type LineDraft = { key: number; description: string; quantity: number; unitValue: number; hsnSacCode: string; unit: string };
let next = 0;
const blank = (): LineDraft => ({ key: ++next, description: "", quantity: 1, unitValue: 0, hsnSacCode: "", unit: "" });

function NewChallanDialog({ purposes, onClose, onCreated }: { purposes: Array<{ code: string; label: string }>; onClose: () => void; onCreated: (id: string) => void }) {
  const workspace = useWorkspaceContext();
  const [purpose, setPurpose] = useState("supply_on_approval");
  const [partyId, setPartyId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([blank()]);
  const parties = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options-search", "customers", text.trim()), queryFn: () => searchSalesOptions("customers", text.trim()).then((r) => r.results.parties ?? []) });
  const save = useMutation({
    mutationFn: () => createChallan({ purpose, partyId, vehicleNumber: vehicle || null,
      lines: lines.filter((line) => line.description.trim() && line.quantity > 0).map((line) => ({ description: line.description.trim(), quantity: line.quantity, unitValue: line.unitValue,
        hsnSacCode: line.hsnSacCode || null, unit: line.unit || null })) }),
    onSuccess: (challan) => onCreated(challan.id),
  });
  const update = (key: number, patch: Partial<LineDraft>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="New delivery challan" size="lg" description="The goods, their value and HSN, and who receives them. Issue it to print and send the goods.">
      <div className="flex flex-col gap-4">
        {save.isError && <p role="alert" className="text-sm text-danger">{save.error instanceof SalesApiError ? save.error.message : "The challan could not be made."}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Why the goods move" selectedKey={purpose} onSelectionChange={(key) => setPurpose(String(key))} options={purposes.map((entry) => ({ value: entry.code, label: entry.label }))} />
          {purpose !== "branch_transfer" ? (
            <ComboBox label="Ship to" isRequired options={(parties.data ?? []).map((party) => ({ value: party.id, label: party.display_name }))} selectedKey={partyId}
              onSelectionChange={(key) => setPartyId(key ? String(key) : null)} onInputChange={setText} isLoading={parties.isFetching} allowsEmptyCollection defaultFilter={() => true}
              placeholder="Search customers" emptyMessage="No matching customers" />
          ) : <span />}
          <TextField label="Vehicle number" value={vehicle} onChange={setVehicle} placeholder="MH12AB1234" />
        </div>
        <div className="flex flex-col gap-2">
          {lines.map((line, index) => (
            <div key={line.key} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto]">
              <TextField aria-label={`Goods ${index + 1}`} label={index === 0 ? "Goods" : undefined} value={line.description} onChange={(value) => update(line.key, { description: value })} />
              <NumberField aria-label={`Quantity ${index + 1}`} label={index === 0 ? "Quantity" : undefined} value={line.quantity} onChange={(value) => update(line.key, { quantity: value })} minValue={0} />
              <TextField aria-label={`Unit ${index + 1}`} label={index === 0 ? "Unit" : undefined} value={line.unit} onChange={(value) => update(line.key, { unit: value })} placeholder="NOS" />
              <NumberField aria-label={`Value per unit ${index + 1}`} label={index === 0 ? "Value / unit" : undefined} value={line.unitValue} onChange={(value) => update(line.key, { unitValue: value })} minValue={0} />
              <TextField aria-label={`HSN ${index + 1}`} label={index === 0 ? "HSN" : undefined} value={line.hsnSacCode} onChange={(value) => update(line.key, { hsnSacCode: value })} />
              <IconButton aria-label={`Remove line ${index + 1}`} variant="ghost" isDisabled={lines.length === 1} onPress={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}>
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
          ))}
          <Button variant="ghost" size="compact" onPress={() => setLines((current) => [...current, blank()])}><Plus className="size-4" aria-hidden="true" />Add goods</Button>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={purpose !== "branch_transfer" && !partyId} onPress={() => save.mutate()}>Make challan</Button>
        </div>
      </div>
    </Dialog>
  );
}
