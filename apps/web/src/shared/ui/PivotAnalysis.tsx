"use client";

// A pivot over billed amounts (Sales analysis; Procurement's purchase analysis): rows and optional columns chosen from the app's
// dimensions, one measure, a date range, totals each way and an Excel copy. The first column stays in place while a wide table scrolls.
// Each app passes its own dimensions, measures, loader and download address.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { EmptyState, ErrorState, PageHeader, Select, TextField, buttonVariants } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";

export type PivotResult = { from: string; to: string; rowsBy: string; columnsBy: string | null; measure: string; measureLabel: string; total: number; truncated: boolean;
  rows: Array<{ key: string; label: string; total: number }>; columns: Array<{ key: string; label: string; total: number }>; cells: Record<string, Record<string, number>> };
type Option = { value: string; label: string };

// failed: what to show instead of the generic error for a particular failure (a missing permission), or null for the generic one.
export function PivotAnalysis({ title, description, queryKey, dimensions, measures, initialRows, initialColumns = "month", moneyMeasure = "amount", load, downloadUrl, empty, format, tabs, failed }: {
  title: string; description: string; queryKey: readonly unknown[]; dimensions: Option[]; measures: Option[]; initialRows: string; initialColumns?: string; moneyMeasure?: string;
  load: (params: URLSearchParams) => Promise<PivotResult>; downloadUrl: (params: URLSearchParams) => string; empty: { title: string; description: string };
  format: (value: number) => string; tabs?: React.ReactNode; failed?: (error: unknown) => React.ReactNode | null;
}) {
  const [rows, setRows] = useState(initialRows);
  const [columns, setColumns] = useState(initialColumns);
  const [measure, setMeasure] = useState(measures[0]?.value ?? moneyMeasure);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const params = new URLSearchParams(Object.entries({ rows, columns: columns === "none" ? "" : columns, measure, from, to }).filter(([, value]) => value) as Array<[string, string]>);
  const query = useQuery({ queryKey: [...queryKey, params.toString()], queryFn: () => load(params), placeholderData: (previous) => previous });
  const data = query.data;
  const show = (value: number) => (measure === moneyMeasure ? format(value) : value.toLocaleString("en-IN"));
  const instead = query.isError && failed ? failed(query.error) : null;
  if (instead) return <>{instead}</>;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={title} description={description}
        primaryAction={<a className={`${buttonVariants({ variant: "secondary" })} flex-1 sm:flex-none`} href={downloadUrl(params)}><Download className="size-4" aria-hidden="true" />Download Excel</a>} />
      {tabs}
      <div className="grid grid-cols-1 gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Select label="Rows" selectedKey={rows} onSelectionChange={(key) => { setRows(String(key)); if (String(key) === columns) setColumns("none"); }} options={dimensions} />
        <Select label="Columns" selectedKey={columns} onSelectionChange={(key) => setColumns(String(key))}
          options={[{ value: "none", label: "None" }, ...dimensions.filter((entry) => entry.value !== rows)]} />
        <Select label="Show" selectedKey={measure} onSelectionChange={(key) => setMeasure(String(key))} options={measures} />
        <TextField label="From" type="date" value={from} onChange={setFrom} description="Empty: the financial year so far." />
        <TextField label="To" type="date" value={to} onChange={setTo} />
      </div>
      {query.isLoading ? <LoadingState label="Working it out" rows={6} />
        : query.isError || !data ? <ErrorState title="Could not work out the analysis" description={query.error instanceof Error ? query.error.message : undefined}
          action={{ label: "Try again", onPress: () => void query.refetch() }} />
        : data.rows.length === 0 ? <EmptyState title={empty.title} description={empty.description} />
        : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
            <table className="w-full min-w-max text-sm">
              <thead className="border-b border-border bg-surface-muted text-left text-xs text-text-secondary">
                <tr>
                  <th className="sticky left-0 bg-surface-muted px-3 py-2 font-medium">{dimensions.find((entry) => entry.value === data.rowsBy)?.label}</th>
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
