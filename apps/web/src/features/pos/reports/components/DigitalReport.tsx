"use client";

// UPI & digital this month: provider-verified collections apart from payments recorded against the shop's static QR, by instrument and mode
// (UPI is never mixed with wallets, netbanking or cards), the digital share of payments, requests still open or expired, refunds, settlement
// and fees — and the payment exceptions (short, excess, duplicate, late, wrong merchant) waiting for Finance, who can refund or close them.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, StatusBadge } from "@vercentlabs/design-system";
import type { PosDigitalPaymentSummary, PosPaymentException } from "@vercentlabs/api";

import { money } from "@/features/pos/shared/format";
import { PosApiError, request } from "@/features/pos/shared/http";
import { PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const TYPE: Record<string, string> = {
  short: "Short payment", excess: "Paid too much", duplicate: "Paid twice", late: "Arrived after cancelling", unmatched: "Unmatched", wrong_merchant: "Wrong merchant",
  wrong_currency: "Wrong currency", conflicting: "Conflicting",
};

export function DigitalReport({ currency = "INR" }: { currency?: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canResolve = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("pos.reconciliation.manage");
  const summary = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "digital-summary"),
    queryFn: () => request<{ summary: PosDigitalPaymentSummary }>("/reports/digital").then((response) => response.summary),
  });
  const exceptions = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "payment-exceptions"),
    queryFn: () => request<{ exceptions: PosPaymentException[] }>("/payment-exceptions?status=open").then((response) => response.exceptions),
  });
  const [error, setError] = useState<string | null>(null);
  const data = summary.data;
  if (!data) return null;
  const m = (value: string | null) => money(currency, value);
  const t = data.totals;
  async function resolve(item: PosPaymentException, action: "refund" | "resolve") {
    const note = window.prompt(action === "refund" ? "Note for the refund" : "How was this resolved?");
    if (!note?.trim()) return;
    setError(null);
    try {
      await request(`/payment-exceptions/${item.id}/resolve`, { method: "POST", body: JSON.stringify({ action, note: note.trim() }) });
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "payment-exceptions") });
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "digital-summary") });
    } catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Could not resolve it."); }
  }
  return (
    <PosPanel title="UPI & digital" description={`${data.from} to ${data.to}. Counted only when the payment provider confirmed it, or recorded against the shop's QR.`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Verified collections", `${m(t.verified)} · ${t.digital_sales}`], ["Shop QR (attested)", m(t.attested)], ["Refunded", m(t.refunded)], ["Net", m(t.net)],
          ["Digital share", `${t.digital_share_percent}%`], ["Open / expired requests", `${t.pending} · ${t.expired_unresolved}`], ["Needs checking", String(t.reconciliation_required)],
          ["Not settled yet", m(t.unsettled)], ["Settled · fees", `${m(t.settled_gross)} · ${m(t.fees)}`], ["Open exceptions", m(data.openExceptionAmount)]].map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2">
            <p className="text-xs text-text-muted">{label}</p>
            <p className="text-base font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      {data.byInstrument.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Instrument</th><th className="pb-1 text-left">How</th><th className="pb-1 text-right">Payments</th><th className="pb-1 text-right">Amount</th></tr></thead>
            <tbody>
              {data.byInstrument.map((row) => (
                <tr key={`${row.instrument}-${row.mode}`} className="border-t border-border">
                  <td className="py-1.5">{row.instrument.toUpperCase()}</td><td>{row.mode.replace(/_/g, " ")}</td><td className="text-right tabular-nums">{row.payments}</td><td className="text-right tabular-nums">{m(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(exceptions.data?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-sm font-medium">Payment exceptions</p>
          {error && <p className="text-sm text-danger-emphasis">{error}</p>}
          {exceptions.data!.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span><StatusBadge tone="warning">{TYPE[item.type] ?? item.type}</StatusBadge> {m(item.amount)}{item.expectedAmount ? ` (bill part ${m(item.expectedAmount)})` : ""}
                {item.transactionReference ? <span className="text-text-muted"> · UTR {item.transactionReference}</span> : null}</span>
              {canResolve && (
                <div className="flex gap-2">
                  {item.providerReference && !["static_qr", "standalone"].includes(item.providerKey) && <Button variant="ghost" size="compact" onPress={() => resolve(item, "refund")}>Refund</Button>}
                  <Button variant="ghost" size="compact" onPress={() => resolve(item, "resolve")}>Close</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </PosPanel>
  );
}
