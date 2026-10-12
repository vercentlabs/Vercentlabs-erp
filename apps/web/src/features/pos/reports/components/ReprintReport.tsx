"use client";

// Receipt reprints this month: how many copies were printed, by whom and why, how the prints ended, and receipts copied again and again
// (worth a look). A reprint never changes a sale — this is an audit view of copies.
import { useQuery } from "@tanstack/react-query";

import { reprintSummary } from "@/features/pos/receipts/api/printing-api";
import { PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function ReprintReport() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "reprint-summary"), queryFn: reprintSummary, retry: false });
  const data = query.data;
  if (!data || data.totals.reprints === 0) return null;
  const t = data.totals;
  return (
    <PosPanel title="Receipt reprints" description={`${data.from} to ${data.to}. Copies of existing receipts — no sale, payment or invoice number is created.`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Copies", String(t.reprints)], ["Receipts copied", String(t.documents)], ["Failed", String(t.failed)], ["Outcome unknown", String(t.unknown)]].map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2">
            <p className="text-xs text-text-muted">{label}</p>
            <p className="text-base font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <table className="w-full text-sm">
          <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">By person</th><th className="pb-1 text-right">Copies</th></tr></thead>
          <tbody>{data.byUser.map((row) => (
            <tr key={row.name} className="border-t border-border"><td className="py-1.5">{row.name}</td><td className="text-right tabular-nums">{row.reprints}</td></tr>
          ))}</tbody>
        </table>
        <table className="w-full text-sm">
          <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Reason</th><th className="pb-1 text-right">Copies</th></tr></thead>
          <tbody>{data.byReason.map((row) => (
            <tr key={row.reason} className="border-t border-border"><td className="py-1.5">{row.label}</td><td className="text-right tabular-nums">{row.reprints}</td></tr>
          ))}</tbody>
        </table>
        <table className="w-full text-sm">
          <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Copied 3+ times</th><th className="pb-1 text-right">Copies</th></tr></thead>
          <tbody>{data.frequent.length === 0
            ? <tr className="border-t border-border"><td className="py-1.5 text-text-muted" colSpan={2}>None</td></tr>
            : data.frequent.map((row) => (
              <tr key={`${row.source_type}:${row.source_id}`} className="border-t border-border"><td className="py-1.5">{row.number}</td><td className="text-right tabular-nums">{row.reprints}</td></tr>
            ))}</tbody>
        </table>
      </div>
    </PosPanel>
  );
}
