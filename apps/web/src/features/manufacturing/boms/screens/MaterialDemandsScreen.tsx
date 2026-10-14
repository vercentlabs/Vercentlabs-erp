"use client";

// Material demand: shortages a planner handed to Procurement from a BOM's requirements — what is needed, how much, where, by when, and for
// which recipe. Procurement acknowledges it, then closes it as fulfilled (naming the requisition or purchase order) or cancelled. Nothing
// here creates a purchase order.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, PermissionState, StatusBadge, TextField } from "@vercentlabs/design-system";

import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { usePagedRows } from "@/shared/ui/list";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus, listDemands, qty, updateDemand, type MaterialDemand } from "../api/bom-api";
import { BOM_BASE } from "./BomListScreen";

const VIEWS = [{ id: "OPEN", label: "Open" }, { id: "ACKNOWLEDGED", label: "Acknowledged" }, { id: "FULFILLED", label: "Fulfilled" }, { id: "CANCELLED", label: "Cancelled" }, { id: "all", label: "All" }];
const TONE: Record<string, "info" | "warning" | "success" | "neutral"> = { OPEN: "warning", ACKNOWLEDGED: "info", FULFILLED: "success", CANCELLED: "neutral" };

export function MaterialDemandsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const mayAct = can("procurement.requisition.manage") || can("procurement.po.create") || can("procurement.po.manage");
  const [view, setView] = useState("OPEN");
  const [selected, setSelected] = useState<MaterialDemand | null>(null);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "material-demands", view), queryFn: () => listDemands(view === "all" ? undefined : view) });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const paged = usePagedRows(rows);
  const columns = useMemo<ColumnDef<MaterialDemand, unknown>[]>(() => [
    { id: "number", accessorKey: "number", header: "Demand", cell: ({ row }) => <span className="font-medium text-text">{row.original.number}</span> },
    { id: "item", accessorKey: "item", header: "Material" },
    { id: "quantity", header: "Quantity", cell: ({ row }) => <span className="tabular-nums">{qty(row.original.quantity)} {row.original.uom}</span> },
    { id: "warehouse", accessorKey: "warehouse", header: "Warehouse", cell: ({ row }) => row.original.warehouse ?? "Any" },
    { id: "requiredBy", accessorKey: "requiredBy", header: "Needed by", cell: ({ row }) => (row.original.requiredBy ? formatDate(row.original.requiredBy) : "—") },
    { id: "source", accessorKey: "source", header: "For", cell: ({ row }) => row.original.bomId
      ? <Link className="text-brand underline" href={`${BOM_BASE}/${row.original.bomId}`} onClick={(event) => event.stopPropagation()}>{row.original.source}</Link> : row.original.source },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={TONE[row.original.status]}>{row.original.status.toLowerCase()}</StatusBadge> },
    { id: "createdAt", accessorKey: "createdAt", header: "Raised", cell: ({ row }) => `${formatDateTime(row.original.createdAt)}${row.original.createdBy ? ` · ${row.original.createdBy}` : ""}` },
  ], []);
  if (query.isError && errorStatus(query.error) === 403) return <PermissionState title="You don't have access to material demand" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage header={{ title: "Material Demand", description: "Shortages Manufacturing handed to Procurement from a BOM's requirements. Procurement buys through its own requisitions and purchase orders." }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}>
      <EnterpriseDataGrid<MaterialDemand>
        aria-label="Material demand" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
        loadingContent={<LoadingState label="Loading material demand" rows={6} />}
        errorContent={<ErrorState title="Could not load material demand" description={errorMessage(query.error)} />}
        emptyContent={<EmptyState title="No material demand here" description="A planner hands shortages here from a BOM's Requirements & cost tab." />}
        {...paged.grid}
        onRowClick={(row) => mayAct && !["FULFILLED", "CANCELLED"].includes(row.status) && setSelected(row)}
      />
      {selected && <DemandDialog demand={selected} onClose={() => setSelected(null)} onDone={async () => { setSelected(null); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") }); }} />}
    </EnterpriseListPage>
  );
}

function DemandDialog({ demand, onClose, onDone }: { demand: MaterialDemand; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (action: "acknowledge" | "fulfil" | "cancel") => {
    setBusy(true); setError(null);
    try { await updateDemand(demand.id, action, note.trim() || undefined); onDone(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`${demand.number} · ${demand.item}`}>
      <div className="flex flex-col gap-3">
        <p className="text-sm">{qty(demand.quantity)} {demand.uom}{demand.warehouse ? ` at ${demand.warehouse}` : ""}{demand.requiredBy ? `, needed by ${formatDate(demand.requiredBy)}` : ""}. {demand.source}</p>
        <TextField label="Note" description="The requisition or purchase order that covers it, or why it is cancelled." value={note} onChange={setNote} maxLength={500} />
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex flex-wrap justify-end gap-2">
          {demand.status === "OPEN" && <Button variant="secondary" isLoading={busy} onPress={() => run("acknowledge")}>Acknowledge</Button>}
          <Button variant="secondary" isLoading={busy} isDisabled={note.trim().length < 3} onPress={() => run("cancel")}>Cancel demand</Button>
          <Button variant="primary" isLoading={busy} isDisabled={note.trim().length < 3} onPress={() => run("fulfil")}>Mark fulfilled</Button>
        </div>
      </div>
    </Dialog>
  );
}
