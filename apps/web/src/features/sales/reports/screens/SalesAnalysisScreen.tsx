"use client";

// Sales › Reports › Analysis (Sales report Phase 3): what was billed, grouped by any one or two of customer, product, salesperson, beat,
// state and month, with totals each way and an Excel copy. The first column stays in place while a wide table scrolls sideways.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { EmptyState, ErrorState, PageHeader, PermissionState, Select, TextField, buttonVariants } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { SalesApiError, request } from "@/features/sales/shared/http";
import { money } from "@/features/sales/shared/format";

type Analysis = { from: string; to: string; rowsBy: string; columnsBy: string | null; measure: string; measureLabel: string; total: number; truncated: boolean;
  rows: Array<{ key: string; label: string; total: number }>; columns: Array<{ key: string; label: string; total: number }>; cells: Record<string, Record<string, number>> };
const DIMENSIONS = [
  { value: "customer", label: "Customer" }, { value: "product", label: "Product" }, { value: "salesperson", label: "Salesperson" }, { value: "beat", label: "Beat" },
  { value: "state", label: "State" }, { value: "month", label: "Month" },
];
const MEASURES = [{ value: "amount", label: "Billed (taxable value)" }, { value: "quantity", label: "Quantity" }, { value: "invoices", label: "Invoices" }];

export function SalesAnalysisScreen() {
  const workspace = useWorkspaceContext();
  const [rows, setRows] = useState("customer");
  const [columns, setColumns] = useState("month");
  const [measure, setMeasure] = useState("amount");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const params = new URLSearchParams(Object.entries({ rows, columns: columns === "none" ? "" : columns, measure, from, to }).filter(([, value]) => value) as Array<[string, string]>);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "analysis", params.toString()), queryFn: () => request<{ analysis: Analysis }>(`/analysis?${params}`).then((result) => result.analysis),
    placeholderData: (previous) => previous });
  const data = query.data;
  const show = (value: number) => (measure === "amount" ? money("INR", value) : value.toLocaleString("en-IN"));
  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to Sales reports" description="Ask an administrator for the Sales reports permission." />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Sales analysis" description="What was billed, grouped the way you choose. Credit notes are taken off."
        primaryAction={<a className={`${buttonVariants({ variant: "secondary" })} flex-1 sm:flex-none`} href={`/api/sales/analysis?${params}&format=xlsx`}>
          <Download className="size-4" aria-hidden="true" />Download Excel</a>} />
      <div className="grid grid-cols-1 gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Select label="Rows" selectedKey={rows} onSelectionChange={(key) => setRows(String(key))} options={DIMENSIONS} />
        <Select label="Columns" selectedKey={columns} onSelectionChange={(key) => setColumns(String(key))}
          options={[{ value: "none", label: "None" }, ...DIMENSIONS.filter((entry) => entry.value !== rows)]} />
        <Select label="Show" selectedKey={measure} onSelectionChange={(key) => setMeasure(String(key))} options={MEASURES} />
        <TextField label="From" type="date" value={from} onChange={setFrom} description="Empty: the financial year so far." />
        <TextField label="To" type="date" value={to} onChange={setTo} />
      </div>
      {query.isLoading ? <LoadingState label="Working it out" rows={6} />
        : query.isError || !data ? <ErrorState title="Could not work out the analysis" action={{ label: "Try again", onPress: () => void query.refetch() }} />
        : data.rows.length === 0 ? <EmptyState title="Nothing billed in these dates" description="Choose other dates." />
        : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
            <table className="w-full min-w-max text-sm">
              <thead className="border-b border-border bg-surface-muted text-left text-xs text-text-secondary">
                <tr>
                  <th className="sticky left-0 bg-surface-muted px-3 py-2 font-medium">{DIMENSIONS.find((entry) => entry.value === data.rowsBy)?.label}</th>
                  {data.columnsBy && data.columns.map((column) => <th key={column.key} className="px-3 py-2 text-right font-medium whitespace-nowrap">{column.label}</th>)}
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.map((row) => (
                  <tr key={row.key}>
                    <td className="sticky left-0 max-w-56 truncate bg-surface px-3 py-2 font-medium" title={row.label}>{row.label}</td>
                    {data.columnsBy && data.columns.map((column) => (
                      <td key={column.key} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{data.cells[row.key]?.[column.key] ? show(data.cells[row.key][column.key]) : ""}</td>
                    ))}
                    <td className="px-3 py-2 text-right font-medium tabular-nums whitespace-nowrap">{show(row.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-surface-muted font-semibold">
                <tr>
                  <td className="sticky left-0 bg-surface-muted px-3 py-2">Total</td>
                  {data.columnsBy && data.columns.map((column) => <td key={column.key} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{show(column.total)}</td>)}
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{show(data.total)}</td>
                </tr>
              </tfoot>
            </table>
            {data.truncated && <p className="border-t border-border px-3 py-2 text-xs text-text-muted">Showing the largest 500 rows and 60 columns. Download Excel for all of them.</p>}
          </div>
        )}
    </div>
  );
}
