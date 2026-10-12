"use client";

// POS GST this month: documents by type and B2B / B2C, rate-wise taxable value and tax (credit notes apart), and documents issued per series
// (first and last number) — the figures a GST return is prepared from. Filing is done in the tax module, not here.
import { useQuery } from "@tanstack/react-query";

import { DOCUMENT_LABEL, gstSummary } from "@/features/pos/invoices/api/invoices-api";
import { money } from "@/features/pos/shared/format";
import { PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function GstReport({ currency = "INR" }: { currency?: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "gst-summary"), queryFn: gstSummary, retry: false });
  const data = query.data;
  if (!data || data.byType.length === 0) return null;
  const tax = (row: { cgst: string; sgst: string; utgst: string; igst: string; cess: string }) => String(Number(row.cgst) + Number(row.sgst) + Number(row.utgst) + Number(row.igst) + Number(row.cess));
  return (
    <PosPanel title="GST invoices" description={`${data.from} to ${data.to}. Issued documents, rate-wise tax and number ranges.`}>
      <div className="grid gap-4 lg:grid-cols-3">
        <table className="w-full text-sm">
          <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Document</th><th className="pb-1 text-right">Count</th><th className="pb-1 text-right">Taxable</th><th className="pb-1 text-right">Tax</th></tr></thead>
          <tbody>{data.byType.map((row) => (
            <tr key={`${row.document_type}:${row.supply_type}`} className="border-t border-border">
              <td className="py-1.5">{DOCUMENT_LABEL[row.document_type] ?? row.document_type} · {row.supply_type.toUpperCase()}</td><td className="text-right tabular-nums">{row.documents}</td>
              <td className="text-right tabular-nums">{money(currency, row.taxable)}</td><td className="text-right tabular-nums">{money(currency, tax(row))}</td>
            </tr>
          ))}</tbody>
        </table>
        <table className="w-full text-sm">
          <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Rate</th><th className="pb-1 text-right">Taxable</th><th className="pb-1 text-right">Tax</th></tr></thead>
          <tbody>{data.byRate.map((row) => (
            <tr key={`${row.side}:${row.rate}`} className="border-t border-border">
              <td className="py-1.5">{row.rate === null ? "—" : `${Number(row.rate)}%`}{row.side === "credit_note" ? " (credit notes)" : ""}</td>
              <td className="text-right tabular-nums">{money(currency, row.taxable)}</td><td className="text-right tabular-nums">{money(currency, tax(row))}</td>
            </tr>
          ))}</tbody>
        </table>
        <table className="w-full text-sm">
          <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Series</th><th className="pb-1 text-left">From – to</th><th className="pb-1 text-right">Issued</th></tr></thead>
          <tbody>{data.series.map((row) => (
            <tr key={`${row.document_type}:${row.financial_year}:${row.prefix}`} className="border-t border-border">
              <td className="py-1.5">{DOCUMENT_LABEL[row.document_type] ?? row.document_type}</td><td>{row.first_number} – {row.last_number}</td><td className="text-right tabular-nums">{row.issued}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </PosPanel>
  );
}
