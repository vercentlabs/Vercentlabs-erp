"use client";

// Transactions › Payments: customer money that could not simply be applied to a sale — short, excess or duplicate payments, payments that
// arrived after a bill was cancelled, unmatched, wrong merchant or currency — waiting for a decision. Those allowed refund it through the
// provider or close it with a note; matching against settlements and the bank is Payment Reconciliation's job.
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, StatusBadge, TextField } from "@vercentlabs/design-system";
import type { PosPaymentException } from "@vercentlabs/api";

import { dateTime, money } from "@/features/pos/shared/format";
import { PosApiError, request } from "@/features/pos/shared/http";
import { PosAlert, PosLoading, PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const TYPE: Record<string, string> = {
  short: "Short payment", excess: "Paid too much", duplicate: "Paid twice", late: "Arrived after cancelling", unmatched: "Unmatched", wrong_merchant: "Wrong merchant",
  wrong_currency: "Wrong currency", conflicting: "Conflicting",
};

export function PaymentExceptionsTab() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canResolve = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("pos.reconciliation.manage");
  const [status, setStatus] = useState("open");
  const key = scopedQueryKey(workspace, "pos", "payment-exceptions", status);
  const query = useQuery({ queryKey: key, queryFn: () => request<{ exceptions: PosPaymentException[] }>(`/payment-exceptions${status === "all" ? "" : `?status=${status}`}`).then((r) => r.exceptions) });
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const resolve = async (item: PosPaymentException, action: "refund" | "resolve") => {
    setError(null);
    try {
      await request(`/payment-exceptions/${item.id}/resolve`, { method: "POST", body: JSON.stringify({ action, note: note.trim() }) });
      setSelected(null);
      setNote("");
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "payment-exceptions") });
    } catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Could not resolve it."); }
  };
  const rows = query.data ?? [];
  return (
    <PosPanel title="Payments needing a decision" description="Money received that is not applied to a sale. A cashier checks a payment's status from the sale; Finance matches settlements in Payment Reconciliation."
      actions={<Link className="text-sm text-brand underline" href="/pos/reconciliation">Payment Reconciliation</Link>}>
      <Select aria-label="Status" size="compact" selectedKey={status} onSelectionChange={(value) => setStatus(String(value))}
        options={[{ value: "open", label: "Open" }, { value: "refund_requested", label: "Refund requested" }, { value: "refunded", label: "Refunded" }, { value: "resolved", label: "Closed" }, { value: "all", label: "All" }]} />
      {error && <PosAlert>{error}</PosAlert>}
      {query.isLoading ? <PosLoading label="Loading payments…" /> : rows.length === 0 ? <p className="text-sm text-text-muted">Nothing here.</p> : (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {rows.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><StatusBadge tone="warning">{TYPE[item.type] ?? item.type}</StatusBadge> {money(item.currency ?? "INR", item.amount)}
                  {item.expectedAmount ? ` (bill part ${money(item.currency ?? "INR", item.expectedAmount)})` : ""}
                  {item.transactionReference ? <span className="text-text-muted"> · UTR {item.transactionReference}</span> : null}
                  <span className="text-text-muted"> · {item.providerKey} · {dateTime(item.createdAt)}</span></span>
                {canResolve && item.status === "open" && selected !== item.id && <Button size="compact" variant="ghost" onPress={() => { setSelected(item.id); setNote(""); }}>Decide</Button>}
                {item.status !== "open" && <span className="text-text-secondary">{item.status.replace(/_/g, " ")}{item.resolutionNote ? ` — ${item.resolutionNote}` : ""}</span>}
              </div>
              {selected === item.id && (
                <div className="flex flex-wrap items-end gap-2">
                  <TextField label="Note" size="compact" value={note} onChange={setNote} maxLength={500} className="sm:min-w-[18rem]" />
                  {item.providerReference && !["static_qr", "standalone"].includes(item.providerKey) && (
                    <Button size="compact" variant="secondary" isDisabled={!note.trim()} onPress={() => resolve(item, "refund")}>Refund to the customer</Button>)}
                  <Button size="compact" variant="secondary" isDisabled={!note.trim()} onPress={() => resolve(item, "resolve")}>Close with note</Button>
                  <Button size="compact" variant="ghost" onPress={() => setSelected(null)}>Cancel</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </PosPanel>
  );
}
