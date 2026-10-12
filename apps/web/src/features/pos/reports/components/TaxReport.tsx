"use client";

// POS tax this month, from finished sales and completed returns as they were recorded: tax by component and rate, sales by treatment, the
// largest HSN / SAC codes, per outlet, B2B against B2C, what returns reversed, and whether everything reconciles. Filing GST returns
// belongs to Finance; these are the POS figures it checks against.
import { useQuery } from "@tanstack/react-query";
import type { PosTaxSummary } from "@vercentlabs/api";

import { money } from "@/features/pos/shared/format";
import { request } from "@/features/pos/shared/http";
import { PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const CLASS: Record<string, string> = {
  taxable: "Taxable", nil_rated: "Nil-rated", exempt: "Exempt", non_gst: "Non-GST", zero_rated: "Zero-rated", not_recorded: "Before tax snapshots",
};

function Table({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-text-muted">
          <tr>{head.map((label, index) => <th key={label} className={`pb-1 ${index === 0 ? "text-left" : "text-right"}`}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-border">
              {row.map((cell, cellIndex) => <td key={cellIndex} className={`py-1.5 pr-2 ${cellIndex === 0 ? "" : "text-right tabular-nums"}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TaxReport() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "tax-summary"), queryFn: () => request<{ summary: PosTaxSummary }>("/reports/taxes").then((response) => response.summary) });
  const data = query.data;
  if (!data) return null;
  const currency = data.currency;
  const m = (value: string) => money(currency, value);
  return (
    <PosPanel title="Tax" description={`${data.from} to ${data.to}. From finished sales and completed returns, as recorded at the time.`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Sales", String(data.totals.sales)], ["Taxable value", m(data.totals.taxable)], ["Tax charged", m(data.totals.tax)], ["Tax reversed by returns", m(data.returns.tax)]].map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2">
            <p className="text-xs text-text-muted">{label}</p>
            <p className="text-base font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      {!data.reconciliation.ok && (
        <p role="alert" className="text-sm text-danger">
          {data.reconciliation.sales_not_matching_lines} sale(s) and {data.reconciliation.lines_not_matching_components} line(s) do not reconcile. Check them before posting to Finance.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Table head={["Component", "Rate", "Taxable", "Tax"]} rows={data.byComponent.map((entry) => [entry.type, `${Number(entry.rate)}%`, m(entry.taxable), m(entry.tax)])} />
        <Table head={["Treatment", "Rate", "Taxable", "Tax"]}
          rows={data.byClassification.map((entry) => [CLASS[entry.classification] ?? entry.classification, entry.rate === "" ? "" : `${Number(entry.rate)}%`, m(entry.taxable), m(entry.tax)])} />
        <Table head={["HSN / SAC", "Quantity", "Taxable", "Tax"]} rows={data.byHsn.slice(0, 10).map((entry) => [entry.hsn, Number(entry.quantity), m(entry.taxable), m(entry.tax)])} />
        <Table head={["Outlet", "GSTIN", "Taxable", "Tax"]} rows={data.byOutlet.map((entry) => [entry.code, entry.gstin, m(entry.taxable), m(entry.tax)])} />
      </div>
      <p className="text-xs text-text-secondary">
        {data.byBuyer.map((entry) => `${entry.treatment.toUpperCase()} ${entry.mode === "walk_in" ? "walk-in" : "named"}: ${m(entry.tax)} on ${m(entry.taxable)} (${entry.sales})`).join(" · ")}
      </p>
    </PosPanel>
  );
}
