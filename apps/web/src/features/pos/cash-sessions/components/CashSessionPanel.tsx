"use client";

// The shift's cash session: the opening count as confirmed (never changed) — amount, where it came from, the drawer, notes and coins, any
// handover and the difference with its reason and approval — corrections a supervisor recorded beside it, and what the drawer should hold now
// (for those who may see expected cash). A correction never edits the count and never invents a cash movement.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, TextField } from "@vercentlabs/design-system";

import { SOURCE_LABEL, cashSession, correctOpening } from "@/features/pos/cash-sessions/api/cash-sessions-api";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime, money } from "@/features/pos/shared/format";
import { PosAlert, PosFacts, PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function CashSessionPanel({ cashSessionId, cashierUserId }: { cashSessionId: string; cashierUserId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "pos", "cash-session", cashSessionId);
  const query = useQuery({ queryKey: key, queryFn: () => cashSession(cashSessionId), retry: false });
  const [corrected, setCorrected] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const data = query.data;
  if (!data) return null;
  const count = data.openingCount;
  const currency = count.currency;
  const correct = async () => {
    setBusy(true);
    setError(null);
    try { queryClient.setQueryData(key, await correctOpening(cashSessionId, { correctedAmount: corrected.trim(), reason: reason.trim() })); setCorrected(""); setReason(""); }
    catch (failure) { setError(failure instanceof PosApiError ? failure.message : "The correction could not be recorded."); } finally { setBusy(false); }
  };
  return (
    <PosPanel title="Cash session" description={`Opening count confirmed by ${count.confirmedBy ?? "the cashier"} at ${dateTime(count.confirmedAt)}.`}>
      <PosFacts columns={2} items={[
        { label: "Opening float", value: money(currency, count.openingAmount) },
        { label: "Source", value: `${SOURCE_LABEL[count.sourceType ?? ""] ?? "—"}${count.sourceReference ? ` · ${count.sourceReference}` : ""}` },
        { label: "Drawer", value: count.cashDrawer ? `${count.cashDrawer.name} (${count.cashDrawer.code})` : "—" },
        { label: "Status", value: data.status },
      ]} />
      {count.denominations && count.denominations.length > 0 && (
        <p className="text-sm text-text-muted">Counted: {count.denominations.map((entry) => `₹${entry.denomination} × ${entry.count}`).join(" · ")}</p>
      )}
      {count.handover && (
        <p className="text-sm">Received from {count.handover.fromShiftNumber ?? "the previous shift"}
          {count.handover.amount ? `: handed over ${money(currency, count.handover.amount)}` : ""}{count.variance ? `, difference ${money(currency, count.variance)}` : ""}
          {count.varianceReason ? ` — ${count.varianceReason}` : ""}{count.approval ? ` (approved${count.approval.approver ? ` by ${count.approval.approver}` : ""})` : ""}.</p>
      )}
      {data.expected && (
        <div className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
          <p className="font-medium">Expected in the drawer: {money(currency, data.expected.expectedCash)}</p>
          <ul className="grid grid-cols-2 gap-x-4 text-text-muted">
            {([["Opening float", data.expected.breakdown.openingFloat], ["Cash received", data.expected.breakdown.cashReceived], ["Change given", data.expected.breakdown.changeGiven],
              ["Cash handed back (uncompleted)", data.expected.breakdown.uncompletedTendersReturned], ["Cash refunds", data.expected.breakdown.cashRefundsPaid],
              ["Cash in", data.expected.breakdown.cashMovementIn], ["Cash out", data.expected.breakdown.cashMovementOut]] as const).map(([label, value]) => (
              <li key={label} className="flex justify-between gap-2"><span>{label}</span><span className="tabular-nums">{money(currency, value)}</span></li>
            ))}
          </ul>
          {data.expected.countedAtClose !== null && <p>Counted at close {money(currency, data.expected.countedAtClose)}, difference {money(currency, data.expected.closingVariance ?? "0")}.</p>}
        </div>
      )}
      {data.corrections.length > 0 && (
        <ul className="border-t border-border pt-3 text-sm">{data.corrections.map((entry) => (
          <li key={entry.id}>Opening count corrected to {money(currency, entry.correctedAmount)} ({money(currency, entry.difference)}) by {entry.recordedBy ?? "a supervisor"} — {entry.reason}</li>
        ))}</ul>
      )}
      {cashierUserId !== workspace.userId && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-sm font-medium">Record an opening count mistake</p>
          <p className="text-xs text-text-muted">The confirmed count stays as it was; the correction is kept beside it and explains the difference at closing. Supervisors only.</p>
          <div className="flex flex-wrap items-end gap-2">
            <TextField label="True opening amount (₹)" inputMode="decimal" value={corrected} onChange={setCorrected} className="sm:max-w-[12rem]" />
            <TextField label="What happened" value={reason} onChange={setReason} maxLength={300} className="sm:max-w-sm" />
            <Button size="compact" variant="secondary" isLoading={busy} isDisabled={!/^\d{1,14}(\.\d{1,2})?$/.test(corrected.trim()) || !reason.trim()} onPress={correct}>Record correction</Button>
          </div>
        </div>
      )}
      {error && <PosAlert>{error}</PosAlert>}
    </PosPanel>
  );
}
