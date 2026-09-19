"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import {
  Button,
  EnterpriseDataGrid,
  EnterpriseListPage,
  ErrorState,
  NoResultsState,
  PermissionState,
  Select,
  StatusBadge,
  type ActiveFilter,
} from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { generatePosDayEndReport, listPosDayEndReports } from "@/features/pos/day-end-reports/api/day-end-reports-api";
import { listPosStores } from "@/features/pos/stores/api/stores-api";
import { listPosTerminals } from "@/features/pos/terminals/api/terminals-api";
import { listPosShifts } from "@/features/pos/overview/api/overview-api";
import { calendarDate, money } from "@/features/pos/shared/format";

const PAGE_SIZE = 25;

const statusTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  draft: "warning",
  reviewed: "info",
  closed: "success",
  void: "neutral",
};

type DayEndReportRow = {
  id: string;
  report_number: string;
  scope_type: string;
  business_date: string;
  status: string;
  store_id: string;
  terminal_id: string | null;
  sale_count: number;
  grand_sales_total: string;
  cash_variance_total: string;
};

export function PosDayEndReportsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const canGenerate = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.reportGenerate);

  const [filters, setFilters] = useState<{ storeId?: string; status?: string }>({});
  const [showGenerate, setShowGenerate] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [genStoreId, setGenStoreId] = useState("");
  const [genScopeType, setGenScopeType] = useState<"shift" | "business_day">("business_day");
  const [genTerminalId, setGenTerminalId] = useState("");
  const [genShiftId, setGenShiftId] = useState("");
  const [genBusinessDate, setGenBusinessDate] = useState("");

  const storesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "stores"), queryFn: listPosStores });
  const terminalsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "terminals"), queryFn: listPosTerminals });
  // listPosShifts/the underlying /api/pos/shifts route only supports
  // limit/offset filters today (see listPointOfSaleResource in
  // services/api/src/modules/point-of-sale/index.js) -- closed-only
  // filtering happens client-side below. The server itself still hard-
  // enforces "closed shifts only" inside generatePosDayEndReport, so this
  // is a UX convenience, not a security boundary.
  const shiftsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "shifts-for-day-end"),
    queryFn: () => listPosShifts({ limit: 200 }),
  });

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "day-end-reports", filters),
    queryFn: () => listPosDayEndReports({ ...filters, limit: PAGE_SIZE }),
    placeholderData: (previous) => previous,
  });

  const storeOptions = useMemo(
    () => (storesQuery.data?.rows ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })),
    [storesQuery.data],
  );
  const terminalOptions = useMemo(
    () =>
      (terminalsQuery.data?.rows ?? [])
        .filter((t) => !genStoreId || (t.storeId ?? t.store_id) === genStoreId)
        .map((t) => ({ value: t.id, label: `${t.name} (${t.code})` })),
    [terminalsQuery.data, genStoreId],
  );
  const closedShiftOptions = useMemo(
    () =>
      (shiftsQuery.data?.rows ?? [])
        .filter((s) => (s as { status?: string }).status === "closed" && (!genStoreId || (s as { store_id?: string }).store_id === genStoreId))
        .map((s) => ({ value: s.id, label: (s as { shift_number?: string }).shift_number || s.id })),
    [shiftsQuery.data, genStoreId],
  );

  const generateMutation = useMutation({
    mutationFn: () =>
      generatePosDayEndReport({
        storeId: genStoreId,
        scopeType: genScopeType,
        terminalId: genTerminalId || undefined,
        shiftId: genScopeType === "shift" ? genShiftId : undefined,
        businessDate: genScopeType === "business_day" ? genBusinessDate : undefined,
      }),
    onSuccess: (result) => {
      setGenerateError(null);
      setShowGenerate(false);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "day-end-reports") });
      router.push(`/pos/reports/day-end/${result.report.id}`);
    },
    onError: (err) => setGenerateError(err instanceof PosApiError ? err.message : "The day-end report could not be generated."),
  });

  const rows = (query.data?.rows ?? []) as DayEndReportRow[];

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const active: ActiveFilter[] = [];
    if (filters.storeId) active.push({ id: "storeId", label: `Store: ${storeOptions.find((s) => s.value === filters.storeId)?.label ?? filters.storeId}` });
    if (filters.status) active.push({ id: "status", label: `Status: ${filters.status}` });
    return active;
  }, [filters, storeOptions]);

  const columns: ColumnDef<DayEndReportRow, unknown>[] = useMemo(
    () => [
      { id: "report_number", header: "Report #", accessorKey: "report_number", cell: ({ row }) => <span className="font-medium text-text">{row.original.report_number}</span> },
      { id: "business_date", header: "Business date", accessorFn: (row) => calendarDate(row.business_date) },
      { id: "scope_type", header: "Scope", accessorFn: (row) => (row.scope_type === "shift" ? "Per shift" : "Business day") },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={statusTone[String(getValue())] ?? "neutral"}>{String(getValue())}</StatusBadge>,
      },
      { id: "sale_count", header: "Sales", accessorKey: "sale_count" },
      { id: "grand_sales_total", header: "Gross sales", accessorFn: (row) => money("", row.grand_sales_total) },
      { id: "cash_variance_total", header: "Cash variance", accessorFn: (row) => money("", row.cash_variance_total) },
    ],
    [],
  );

  const gridState = query.isLoading
    ? "loading"
    : query.isError && query.error instanceof PosApiError && query.error.status === 403
      ? "permission-denied"
      : query.isError
        ? "error"
        : rows.length === 0
          ? "empty"
          : "ready";

  return (
    <EnterpriseListPage
      header={{
        title: "Day-end (Z) reports",
        description: "Immutable, numbered end-of-day reconciliations of sales, tax, returns, tenders and cash for a shift or a business day.",
        primaryAction: canGenerate ? (
          <Button variant="primary" onPress={() => setShowGenerate((v) => !v)}>
            <Plus className="size-4" aria-hidden="true" />
            Generate report
          </Button>
        ) : undefined,
      }}
      actionBar={{
        start: (
          <>
            <Select
              aria-label="Store"
              size="compact"
              options={[{ value: "", label: "Any store" }, ...storeOptions]}
              selectedKey={filters.storeId ?? ""}
              onSelectionChange={(key) => setFilters((current) => ({ ...current, storeId: key ? String(key) : undefined }))}
            />
            <Select
              aria-label="Status"
              size="compact"
              options={[
                { value: "", label: "Any status" },
                { value: "draft", label: "Draft" },
                { value: "reviewed", label: "Reviewed" },
                { value: "closed", label: "Closed" },
                { value: "void", label: "Void" },
              ]}
              selectedKey={filters.status ?? ""}
              onSelectionChange={(key) => setFilters((current) => ({ ...current, status: key ? String(key) : undefined }))}
            />
          </>
        ),
      }}
      filterBar={{
        filters: activeFilters,
        onRemove: (id) => setFilters((current) => ({ ...current, [id]: undefined })),
        onClearAll: activeFilters.length > 0 ? () => setFilters({}) : undefined,
      }}
    >
      {showGenerate && (
        <div className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border-strong bg-surface p-4">
          <h2 className="text-sm font-semibold text-text">Generate a day-end report</h2>
          {generateError && (
            <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              {generateError}
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select label="Store" options={storeOptions} value={genStoreId} onChange={(value) => setGenStoreId(String(value ?? ""))} placeholder="Select a store" />
            <Select
              label="Scope"
              options={[
                { value: "business_day", label: "Business day (all shifts)" },
                { value: "shift", label: "Single shift" },
              ]}
              value={genScopeType}
              onChange={(value) => setGenScopeType(String(value) as "shift" | "business_day")}
            />
            {genScopeType === "shift" ? (
              <Select label="Closed shift" options={closedShiftOptions} value={genShiftId} onChange={(value) => setGenShiftId(String(value ?? ""))} placeholder="Select a closed shift" />
            ) : (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-text" htmlFor="day-end-business-date">
                  Business date
                </label>
                <input
                  id="day-end-business-date"
                  type="date"
                  value={genBusinessDate}
                  onChange={(event) => setGenBusinessDate(event.target.value)}
                  className="rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-sm text-text"
                />
              </div>
            )}
            <Select
              label="Terminal (optional for business day)"
              options={[{ value: "", label: "All terminals in store" }, ...terminalOptions]}
              value={genTerminalId}
              onChange={(value) => setGenTerminalId(String(value ?? ""))}
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              onPress={() => generateMutation.mutate()}
              isDisabled={!genStoreId || (genScopeType === "shift" ? !genShiftId : !genBusinessDate)}
              isLoading={generateMutation.isPending}
            >
              Generate
            </Button>
            <Button variant="secondary" onPress={() => setShowGenerate(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <EnterpriseDataGrid<DayEndReportRow>
        aria-label="Day-end reports"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        onRowClick={(row) => router.push(`/pos/reports/day-end/${row.id}`)}
        state={gridState}
        loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading day-end reports…</p>}
        emptyContent={<NoResultsState title="No day-end reports yet" description="Generate one for a closed shift or a business day to see it here." />}
        errorContent={<ErrorState title="Could not load day-end reports" action={{ label: "Retry", onPress: () => query.refetch() }} />}
        permissionDeniedContent={<PermissionState title="You don't have access to day-end reports" />}
      />
    </EnterpriseListPage>
  );
}
