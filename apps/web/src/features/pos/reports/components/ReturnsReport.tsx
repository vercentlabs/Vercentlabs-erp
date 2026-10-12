"use client";

// Returns this month: posted returns and their value (gross, discounts given back, net, tax), why goods came back, in what condition and
// where they went, exceptions and no-receipt returns — and refunds by method and status, money refunded kept apart from money still owed.
import { useQuery } from "@tanstack/react-query";
import type { PosReturnSummaryGroup } from "@vercentlabs/api";

import { CONDITION_LABEL, DISPOSITION_LABEL, REASON_LABEL } from "@/features/pos/returns/api/returns-api";
import { request } from "@/features/pos/shared/http";
import { money } from "@/features/pos/shared/format";
import { PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Summary = {
  from: string; to: string; byStatus: Array<{ status: string; returns: number }>;
  posted: { returns: number; quantity: string; gross: string; discounts: string; net: string; tax: string; refund_due: string; no_receipt: number; with_exceptions: number };
  byReason: PosReturnSummaryGroup[]; byCondition: PosReturnSummaryGroup[]; byDisposition: PosReturnSummaryGroup[]; byItem: PosReturnSummaryGroup[];
  refunds: Array<{ method: string; status: string; refunds: number; amount: string }>;
};

function Group({ title, rows, label, currency }: { title: string; rows: PosReturnSummaryGroup[]; label: (key: string) => string; currency: string }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">{title}</th><th className="pb-1 text-right">Qty</th><th className="pb-1 text-right">Value</th></tr></thead>
      <tbody>{rows.map((row) => (
        <tr key={row.key} className="border-t border-border"><td className="py-1.5">{label(row.key)}</td><td className="text-right tabular-nums">{Number(row.quantity)}</td>
          <td className="text-right tabular-nums">{money(currency, row.value)}</td></tr>
      ))}</tbody>
    </table>
  );
}

export function ReturnsReport({ currency = "INR" }: { currency?: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "returns-summary"), queryFn: () => request<{ summary: Summary }>("/reports/returns").then((result) => result.summary), retry: false });
  const data = query.data;
  if (!data || data.byStatus.length === 0) return null;
  const p = data.posted;
  const owed = data.refunds.filter((row) => row.status !== "completed").reduce((sum, row) => sum + Number(row.amount), 0);
  const paid = data.refunds.filter((row) => row.status === "completed").reduce((sum, row) => sum + Number(row.amount), 0);
  return (
    <PosPanel title="Returns" description={`${data.from} to ${data.to}. Values are the original sales' — never today's prices.`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Posted returns", String(p.returns)], ["Net returned", money(currency, p.net)], ["Tax reversed", money(currency, p.tax)], ["Discounts given back", money(currency, p.discounts)],
          ["Refunded", money(currency, String(paid))], ["Refunds still owed", money(currency, String(owed))], ["No receipt", String(p.no_receipt)], ["With exceptions", String(p.with_exceptions)]].map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2">
            <p className="text-xs text-text-muted">{label}</p>
            <p className="text-base font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Group title="Reason" rows={data.byReason} label={(key) => REASON_LABEL[key] ?? key} currency={currency} />
        <Group title="Condition" rows={data.byCondition} label={(key) => CONDITION_LABEL[key] ?? key} currency={currency} />
        <Group title="Goods went to" rows={data.byDisposition} label={(key) => DISPOSITION_LABEL[key] ?? key} currency={currency} />
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Refunds by method</th><th className="pb-1 text-left">Status</th><th className="pb-1 text-right">Count</th><th className="pb-1 text-right">Amount</th></tr></thead>
        <tbody>{data.refunds.map((row) => (
          <tr key={`${row.method}:${row.status}`} className="border-t border-border"><td className="py-1.5">{row.method.toUpperCase()}</td><td>{row.status === "completed" ? "Refunded" : row.status === "failed" ? "Failed" : "Waiting"}</td>
            <td className="text-right tabular-nums">{row.refunds}</td><td className="text-right tabular-nums">{money(currency, row.amount)}</td></tr>
        ))}</tbody>
      </table>
    </PosPanel>
  );
}
