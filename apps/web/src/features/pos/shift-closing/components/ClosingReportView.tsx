"use client";

// The closing report as it was frozen at the close (the server's snapshot, checked against its hash). The cashier copy leaves out expected
// cash and the drawer breakdown; the reconciliation copy is for those who may see expected cash. Printing records the print and opens the
// browser's print dialog — a printer problem never changes the closed shift; reprint later.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { DESTINATION_LABEL, closingReport, printClosingReport, type ClosingReport } from "@/features/pos/shift-closing/api/shift-closing-api";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime, money } from "@/features/pos/shared/format";
import { PosAlert } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const BREAKDOWN: Array<[string, string]> = [["openingFloat", "Opening float"], ["cashReceived", "Cash received"], ["changeGiven", "Change given"],
  ["uncompletedTendersReturned", "Cash handed back (uncompleted)"], ["cashRefundsPaid", "Cash refunds paid"], ["cashMovementIn", "Cash in"], ["cashMovementOut", "Cash out"]];

export function ClosingReportView({ shiftId, canSeeExpected }: { shiftId: string; canSeeExpected: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [variant, setVariant] = useState<"CASHIER" | "RECONCILIATION">(canSeeExpected ? "RECONCILIATION" : "CASHIER");
  const key = scopedQueryKey(workspace, "pos", "closing-report", shiftId, variant);
  const query = useQuery({ queryKey: key, queryFn: () => closingReport(shiftId, variant), retry: false });
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (query.isLoading) return <p className="text-sm text-text-muted">Loading the closing report…</p>;
  if (query.isError || !query.data) return <PosAlert tone="warning">Shift closed, but the report is temporarily unavailable. Try again shortly.</PosAlert>;
  const report: ClosingReport = query.data;
  const s = report.snapshot;
  const currency = s.currency || "INR";
  const print = async (format: "THERMAL" | "A4") => {
    setBusy(true);
    setError(null);
    try {
      queryClient.setQueryData(key, await printClosingReport(shiftId, { variant, format, reason: reason.trim() || undefined }));
      setReason("");
      window.print();
    } catch (failure) { setError(failure instanceof PosApiError ? failure.message : "The report could not be printed. The shift stays closed; try again."); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-end gap-2">
        {canSeeExpected && (
          <Select label="Report" size="compact" selectedKey={variant} onSelectionChange={(value) => setVariant(value === "CASHIER" ? "CASHIER" : "RECONCILIATION")}
            options={[{ value: "RECONCILIATION", label: "Reconciliation report" }, { value: "CASHIER", label: "Cashier report" }]} />
        )}
        {report.prints > 0 && <TextField label="Reason for reprint" size="compact" value={reason} onChange={setReason} maxLength={300} />}
        <Button size="compact" variant="secondary" isLoading={busy} onPress={() => print("THERMAL")}>{report.prints ? "Reprint receipt" : "Print receipt"}</Button>
        <Button size="compact" variant="secondary" isLoading={busy} onPress={() => print("A4")}>{report.prints ? "Reprint A4" : "Print A4"}</Button>
        <StatusBadge tone={report.verified ? "success" : "danger"}>{report.verified ? "Snapshot verified" : "Snapshot mismatch"}</StatusBadge>
      </div>
      {error && <PosAlert>{error}</PosAlert>}
      <article className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3 text-sm">
        <header>
          <p className="font-semibold">Shift closing · {s.shift.number}</p>
          <p className="text-text-muted">{s.shift.outlet} · {s.shift.terminalName} ({s.shift.terminal}){s.shift.drawer ? ` · ${s.shift.drawer}` : ""} · {s.shift.cashier ?? "—"}</p>
          <p className="text-text-muted">Opened {dateTime(s.times.openedAt)} · closed {dateTime(s.times.closedAt)}{s.times.durationMinutes !== null ? ` · ${Math.floor(s.times.durationMinutes / 60)}h ${s.times.durationMinutes % 60}m` : ""}</p>
        </header>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          <dt className="text-text-muted">Completed sales</dt><dd className="text-right tabular-nums">{s.sales.count} · {money(currency, s.sales.total)}</dd>
          {s.payments.map((row) => (
            <PaymentRow key={row.method} label={`${row.method.toUpperCase()} (${row.count})`} value={money(currency, row.amount)} />
          ))}
          {s.split.sales > 0 && <PaymentRow label={`Split payments (${s.split.sales} sales)`} value={s.split.components.map((row) => `${row.method.toUpperCase()} ${money(currency, row.amount)}`).join(" + ")} />}
          {s.refunds.map((row) => <PaymentRow key={`${row.method}-${row.status}`} label={`Refund ${row.method} · ${row.status}`} value={money(currency, row.amount)} />)}
        </dl>
        {s.cash ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-2">
            {s.cash.breakdown ? BREAKDOWN.map(([field, label]) => <PaymentRow key={field} label={label} value={money(currency, s.cash!.breakdown![field])} />)
              : <PaymentRow label="Opening float" value={money(currency, s.cash.openingFloat)} />}
            {s.cash.expected !== null && <PaymentRow label="Expected cash" value={money(currency, s.cash.expected)} strong />}
            <PaymentRow label="Counted cash" value={money(currency, s.cash.counted)} strong />
            {s.cash.variance !== null && <PaymentRow label="Difference" value={money(currency, s.cash.variance)} strong />}
            {s.cash.varianceReasonLabel && <PaymentRow label="Reason" value={`${s.cash.varianceReasonLabel}${s.cash.varianceReason ? ` — ${s.cash.varianceReason}` : ""}`} />}
          </dl>
        ) : <p className="border-t border-border pt-2 text-text-muted">Card / UPI shift — no cash count.</p>}
        {s.approvals.length > 0 && <p>{s.approvals.map((row) => `${row.reconciledBySupervisor ? "Reconciled" : "Approved"} by ${row.approver ?? "a supervisor"} (${money(currency, row.amount)})`).join("; ")}</p>}
        {report.custodyNow.length > 0 && (
          <ul className="border-t border-border pt-2">
            {report.custodyNow.map((row) => (
              <li key={row.id}>{DESTINATION_LABEL[row.type]}{row.recipient ? ` (${row.recipient})` : ""}{row.reference ? ` · ${row.reference}` : ""}: {money(currency, row.amount)} —{" "}
                {row.status === "ACCEPTED" ? `accepted by ${row.acceptedBy ?? "recipient"}${row.varianceAmount && row.varianceAmount !== "0.00" ? ` (difference ${money(currency, row.varianceAmount)})` : ""}` : "pending acceptance"}</li>
            ))}
          </ul>
        )}
        {s.exceptions.length > 0 && <ul className="border-t border-border pt-2">{s.exceptions.map((row) => <li key={`${row.type}-${row.referenceId}`}>Open: {row.label}</li>)}</ul>}
        <footer className="border-t border-border pt-2 text-text-muted">
          Closed by {s.closedBy ?? "—"}{s.closingType === "FORCE" ? " (force-closed)" : ""}{s.closeReason ? ` — ${s.closeReason}` : ""}. {s.openBillsHeld > 0 ? `${s.openBillsHeld} unfinished bill(s) held. ` : ""}
          {report.variant === "CASHIER" ? "Cashier copy." : "Reconciliation copy."}
        </footer>
      </article>
    </div>
  );
}

function PaymentRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <>
      <dt className={strong ? "font-medium" : "text-text-muted"}>{label}</dt>
      <dd className={`text-right tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </>
  );
}
