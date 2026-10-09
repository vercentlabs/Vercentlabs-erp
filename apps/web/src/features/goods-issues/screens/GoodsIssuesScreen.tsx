"use client";

// Goods Issues: stock deliberately taken out of inventory for a known internal purpose — consumption, maintenance, samples, project use, scrap
// and disposal. Not for sales (Sales Delivery), supplier returns (Purchase Return), moves (Transfer) or unexplained differences (Adjustment).
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Settings2 } from "lucide-react";
import {
  EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, Select, StatusBadge, TextField,
} from "@vercentlabs/design-system";

import { money } from "@/features/items/item-format";
import { formatDate } from "@/shared/format/human";
import { ColumnsMenu, filterBarOf, optionLabel, useColumnVisibility, useDebouncedValue, usePagedRows, type OptionalColumn } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { STATUS_LABEL, errorCode, errorMessage, getGoodsIssueOptions, listGoodsIssues, type GoodsIssueHeader, type GoodsIssueStatus } from "../api/goods-issues-api";

export const GOODS_ISSUES_BASE = "/inventory/goods-issues";
const ANY = "any";
const VIEWS = [{ id: ANY, label: "All" }, { id: "draft", label: "Draft" }, { id: "posted", label: "Posted" }, { id: "reversed", label: "Reversed" }, { id: "cancelled", label: "Cancelled" }];
export const STATUS_TONE: Record<GoodsIssueStatus, "info" | "success" | "warning" | "neutral"> = { draft: "info", posted: "success", partially_reversed: "warning", reversed: "warning", cancelled: "neutral" };
const OPTIONAL: OptionalColumn[] = [
  { id: "reason", label: "Reason" }, { id: "issuedTo", label: "Issued to" }, { id: "lineCount", label: "Items" }, { id: "value", label: "Value" },
  { id: "externalReference", label: "Reference" }, { id: "project", label: "Project", hiddenByDefault: true }, { id: "costCenter", label: "Cost center", hiddenByDefault: true },
  { id: "issuedByName", label: "Issued by" },
];

export function GoodsIssuesScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get("view") ?? ANY);
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [warehouseId, setWarehouseId] = useState(ANY);
  const [reasonId, setReasonId] = useState(ANY);
  const [issueToType, setIssueToType] = useState(ANY);
  const [projectId, setProjectId] = useState(ANY);
  const [costCenterId, setCostCenterId] = useState(ANY);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const pick = (value: string) => (value === ANY ? undefined : value);
  const filters = { status: pick(status), search: submitted || undefined, warehouseId: pick(warehouseId), reasonId: pick(reasonId), issueToType: pick(issueToType),
    projectId: pick(projectId), costCenterId: pick(costCenterId), from: from || undefined, to: to || undefined };
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "goods-issues", "options"), queryFn: getGoodsIssueOptions, staleTime: 60_000 });
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "goods-issues", "list", filters), queryFn: () => listGoodsIssues(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "issueDate", desc: true }] });
  const columns = useColumnVisibility("inventory.goods-issues.columns", OPTIONAL);
  const showValue = Boolean(list.data?.seesCost);

  const gridColumns = useMemo(() => ([
    { id: "number", accessorKey: "number", header: "Goods issue", enableHiding: false, cell: ({ row }) => <span className="font-medium text-text">{row.original.number}</span> },
    { id: "issueDate", accessorKey: "issueDate", header: "Issue date", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{formatDate(row.original.issueDate)}</span> },
    { id: "warehouse", accessorKey: "warehouse", header: "Warehouse", cell: ({ row }) => row.original.warehouse },
    { id: "reason", accessorKey: "reason", header: "Reason", cell: ({ row }) => row.original.reason },
    { id: "issuedTo", accessorKey: "issuedTo", header: "Issued to", cell: ({ row }) => row.original.issuedTo ?? "" },
    { id: "lineCount", accessorKey: "lineCount", header: "Items", cell: ({ row }) => <span className="tabular-nums">{row.original.lineCount}</span> },
    { id: "value", accessorKey: "value", header: "Value", cell: ({ row }) => <span className="tabular-nums">{row.original.value === undefined ? "—" : money(row.original.value)}</span> },
    { id: "externalReference", accessorKey: "externalReference", header: "Reference", cell: ({ row }) => row.original.externalReference ?? "" },
    { id: "project", accessorKey: "project", header: "Project", cell: ({ row }) => row.original.project ?? "" },
    { id: "costCenter", accessorKey: "costCenter", header: "Cost center", cell: ({ row }) => row.original.costCenter ?? "" },
    { id: "status", accessorKey: "status", header: "Status", enableHiding: false, cell: ({ row }) => <StatusBadge tone={STATUS_TONE[row.original.status]}>{STATUS_LABEL[row.original.status]}</StatusBadge> },
    { id: "issuedByName", accessorKey: "issuedByName", header: "Issued by", cell: ({ row }) => row.original.issuedByName ?? row.original.postedByName ?? "" },
  ] satisfies ColumnDef<GoodsIssueHeader, unknown>[]).filter((column) => showValue || column.id !== "value"), [showValue]);

  if (list.isError && errorCode(list.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to goods issues" description="Ask an administrator for the View goods issues permission." />;
  const can = options.data?.capabilities;
  const o = options.data;
  const filterBar = filterBarOf([
    { id: "warehouse", active: warehouseId !== ANY, label: `Warehouse: ${optionLabel(o?.warehouses, warehouseId, "code")}`, clear: () => setWarehouseId(ANY) },
    { id: "reason", active: reasonId !== ANY, label: `Reason: ${optionLabel(o?.reasons, reasonId)}`, clear: () => setReasonId(ANY) },
    { id: "issueTo", active: issueToType !== ANY, label: `Issued to: ${optionLabel(o?.issueToTypes, issueToType)}`, clear: () => setIssueToType(ANY) },
    { id: "project", active: projectId !== ANY, label: `Project: ${optionLabel(o?.projects, projectId)}`, clear: () => setProjectId(ANY) },
    { id: "costCenter", active: costCenterId !== ANY, label: `Cost center: ${optionLabel(o?.costCenters, costCenterId)}`, clear: () => setCostCenterId(ANY) },
    { id: "from", active: Boolean(from), label: `On or after ${formatDate(from)}`, clear: () => setFrom("") },
    { id: "to", active: Boolean(to), label: `On or before ${formatDate(to)}`, clear: () => setTo("") },
  ], paged.resetPage);
  const filtered = Boolean(submitted) || Boolean(filterBar) || status !== ANY;

  return (
    <EnterpriseListPage
      header={{
        title: "Goods Issues",
        description: "Stock taken out of inventory on purpose: consumption, maintenance, samples, project use, scrap and disposal. Sales ship through deliveries, supplier returns through purchase returns, moves through transfers, count differences through adjustments.",
        primaryAction: list.data?.canCreate ? <LinkButton href={`${GOODS_ISSUES_BASE}/new`} variant="primary"><Plus className="size-4" aria-hidden="true" />New goods issue</LinkButton> : undefined,
        secondaryActions: can?.manageReasons ? <LinkButton href="/inventory/settings?section=reasons&reason=goods-issue" variant="outline"><Settings2 className="size-4" aria-hidden="true" />Reasons</LinkButton> : undefined,
      }}
      savedViews={{ views: VIEWS, activeViewId: status, onSelect: (id) => { setStatus(id); paged.resetPage(); } }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search goods issues" placeholder="Number, reference, recipient, SKU or item" className="w-full sm:w-80" value={search} onChange={setSearch} />
            <Select aria-label="Warehouse" size="compact" selectedKey={warehouseId} onSelectionChange={(key) => setWarehouseId(String(key))}
              options={[{ value: ANY, label: "Any warehouse" }, ...(o?.warehouses ?? []).map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))]} />
            <Select aria-label="Reason" size="compact" selectedKey={reasonId} onSelectionChange={(key) => setReasonId(String(key))}
              options={[{ value: ANY, label: "Any reason" }, ...(o?.reasons ?? []).map((entry) => ({ value: entry.id, label: entry.name }))]} />
            <Select aria-label="Issued to" size="compact" selectedKey={issueToType} onSelectionChange={(key) => setIssueToType(String(key))}
              options={[{ value: ANY, label: "Any recipient" }, ...(o?.issueToTypes ?? []).map((entry) => ({ value: entry.id, label: entry.label }))]} />
            {(o?.projects.length ?? 0) > 0 && <Select aria-label="Project" size="compact" selectedKey={projectId} onSelectionChange={(key) => setProjectId(String(key))}
              options={[{ value: ANY, label: "Any project" }, ...(o?.projects ?? []).map((entry) => ({ value: entry.id, label: entry.name }))]} />}
            {(o?.costCenters.length ?? 0) > 0 && <Select aria-label="Cost center" size="compact" selectedKey={costCenterId} onSelectionChange={(key) => setCostCenterId(String(key))}
              options={[{ value: ANY, label: "Any cost center" }, ...(o?.costCenters ?? []).map((entry) => ({ value: entry.id, label: entry.name }))]} />}
            <TextField aria-label="From date" type="date" value={from} onChange={setFrom} />
            <TextField aria-label="To date" type="date" value={to} onChange={setTo} />
          </>
        ),
        end: <ColumnsMenu columns={OPTIONAL.filter((column) => showValue || column.id !== "value")} visibility={columns.visibility} onChange={columns.setVisibility} />,
      }}
      filterBar={filterBar}
    >
      <EnterpriseDataGrid<GoodsIssueHeader>
        aria-label="Goods issues"
        columns={gridColumns}
        data={paged.pageRows}
        getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (filtered ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading goods issues" rows={8} />}
        errorContent={<ErrorState title="Could not load goods issues" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No goods issues yet" description="Record stock used for maintenance, consumption, samples, projects or disposal."
          action={list.data?.canCreate ? { label: "New goods issue", onPress: () => router.push(`${GOODS_ISSUES_BASE}/new`) } : undefined} />}
        noResultsContent={<NoResultsState title="No goods issues match" description="Try a different view, search or filter." />}
        {...paged.grid}
        columnVisibility={columns.visibility}
        onColumnVisibilityChange={columns.setVisibility}
        onRowClick={(row) => router.push(`${GOODS_ISSUES_BASE}/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span>
              <StatusBadge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</StatusBadge></span>
            <span className="text-xs text-text-muted">{formatDate(row.issueDate)} · {row.warehouse} · {row.reason}</span>
            {row.issuedTo && <span className="text-xs text-text-secondary">To {row.issuedTo}</span>}
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
