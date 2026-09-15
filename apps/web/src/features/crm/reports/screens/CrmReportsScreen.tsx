"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, Select, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { CrmReportApiError, getCrmReportData } from "../api/reports-api";
import { CRM_REPORT_OPTIONS, type CrmReportRow } from "../types";

function titleCase(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase());
}

// F030 Tranche K numeric sweep — getCrmReport's rows carry dynamic,
// per-report-kind keys (revenue-operations/forecast/partner-pipeline
// aggregates especially), several of which are ::numeric-cast SQL sums
// (target/allocated/actual_won_amount/quota/pipeline/best_case/
// committed/won/expected_value — see analytics-service.js/opportunity-
// revenue-intelligence.js). node-postgres returns NUMERIC/DECIMAL as
// strings, so `typeof value === "number"` alone silently skipped
// thousands-separator formatting for every one of them — the same
// class of gap the Dashboard/Forecast money() fix closed, now closed
// here too. A strict "is this string entirely numeric" regex avoids
// misformatting a genuinely textual value that happens to start with a
// digit (e.g. a code or period label).
const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;

function formatCell(value: string | number | null) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return value.toLocaleString();
  if (NUMERIC_STRING.test(value)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric.toLocaleString();
  }
  return String(value);
}

export function CrmReportsScreen() {
  const workspace = useWorkspaceContext();
  const [report, setReport] = useState<string>(CRM_REPORT_OPTIONS[0].value);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<{ from?: string; to?: string }>({});

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "reports", report, appliedFilters),
    queryFn: () => getCrmReportData(report, appliedFilters),
  });

  const rows: CrmReportRow[] = useMemo(() => query.data?.report.rows ?? [], [query.data]);

  const columns: ColumnDef<CrmReportRow, unknown>[] = useMemo(() => {
    const first = rows[0];
    if (!first) return [];
    return Object.keys(first).map((key) => ({
      id: key,
      header: titleCase(key),
      accessorFn: (row: CrmReportRow) => row[key],
      cell: ({ getValue }: { getValue: () => unknown }) => formatCell(getValue() as string | number | null),
    }));
  }, [rows]);

  const gridState = query.isLoading
    ? "loading"
    : query.isError && query.error instanceof CrmReportApiError && query.error.status === 403
      ? "permission-denied"
      : query.isError
        ? "error"
        : rows.length === 0
          ? "empty"
          : "ready";

  return (
    <EnterpriseListPage
      header={{ title: "Reports", description: "Pipeline, conversion, forecast and coverage reports — scoped to what you can see." }}
      actionBar={{
        start: (
          <div className="flex flex-wrap items-end gap-2">
            <Select
              aria-label="Report"
              options={CRM_REPORT_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
              selectedKey={report}
              onSelectionChange={(key) => key && setReport(String(key))}
              className="min-w-[220px]"
            />
            <TextField aria-label="From date" label="From" placeholder="YYYY-MM-DD" value={from} onChange={setFrom} />
            <TextField aria-label="To date" label="To" placeholder="YYYY-MM-DD" value={to} onChange={setTo} />
            <Button
              variant="secondary"
              onPress={() => setAppliedFilters({ from: from || undefined, to: to || undefined })}
            >
              Apply
            </Button>
          </div>
        ),
      }}
    >
      <EnterpriseDataGrid<CrmReportRow>
        aria-label={`${report} report`}
        columns={columns}
        data={rows}
        state={gridState}
        loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Running report…</p>}
        emptyContent={<NoResultsState title="No data for this report and date range" />}
        errorContent={<ErrorState title="Could not run this report" action={{ label: "Retry", onPress: () => query.refetch() }} />}
        permissionDeniedContent={<PermissionState title="You don't have access to CRM Reports" />}
      />
    </EnterpriseListPage>
  );
}
