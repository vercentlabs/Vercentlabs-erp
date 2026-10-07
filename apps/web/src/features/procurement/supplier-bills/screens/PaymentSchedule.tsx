"use client";

// A supplier bill's payment schedule: the instalments its payment terms gave when it posted, what Finance's payments, advances and credits
// settled of each, and what is still owed — one payable, several due dates. A reschedule is requested with a reason and approved by Finance;
// the original due date stays beside the revised one. The statutory deadlines (MSMED Act) are shown separately and never move.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { ProcAlert, ProcFacts, ProcPanel } from "@/features/procurement/shared/ProcUi";
import { calendarDate, dateTime, money, statusLabel } from "@/features/procurement/shared/format";

export type BillPaymentSchedule = {
  billId: string; billNumber: string; currencyCode: string; status: string; today: string;
  paymentTerm: { id: string; code: string; name: string; termTypeLabel: string; summary: string; version: number; advancePercentage: string | null } | null;
  invoiceDate: string; invoiceReceivedDate: string | null; postingDate: string; summaryDueDate: string | null; supplierStatedTerms: string | null; paymentTermChangeReason: string | null;
  installments: Array<{ id: string; installment: number; percentage: string | null; basis: string | null; referenceDate: string | null; scheduled: string; settled: string; outstanding: string;
    originalDueDate: string; dueDate: string; rescheduled: boolean; state: string; pendingReschedule: boolean }>;
  totals: { scheduled: string; settled: string; outstanding: string; billOutstanding: string; reconciled: boolean };
  reschedules: Array<{ id: string; scheduleId: string; previousDueDate: string; requestedDueDate: string; reason: string; status: string; requestedBy: string | null; requestedAt: string;
    decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; canDecide: boolean }>;
  compliance: Array<{ id: string; sourceReference: string; acceptanceDate: string; acceptanceBasis: string; agreementBasis: string; agreedDays: number | null; statutoryDays: number;
    statutoryDueDate: string; amount: string; outstanding: string; status: string; disputed: boolean; disputeReference: string | null; classification: string | null; compliance: string }>;
  actions: { requestReschedule: boolean; recordPayment: boolean };
};

const STATE_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { paid: "success", overdue: "danger", due_today: "warning", partially_paid: "info", upcoming: "neutral",
  draft: "neutral", breached: "danger", within_deadline: "success", settled: "success", disputed: "warning", superseded: "neutral", void: "neutral" };
const BASIS: Record<string, string> = { invoice_date: "Invoice date", invoice_received: "Invoice received", posting_date: "Posting date" };

async function post(path: string, body: unknown) {
  const response = await fetch(`/api/procurement/supplier-bills${path}`, { method: "POST", credentials: "same-origin", headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message || "The request could not be completed.");
  return payload;
}

export function PaymentSchedulePanel({ schedule }: { schedule: BillPaymentSchedule }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [requesting, setRequesting] = useState<string | null>(null);
  const [disputing, setDisputing] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const refresh = () => void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") });
  const decide = useMutation({ mutationFn: ({ id, action, note }: { id: string; action: "approve" | "reject"; note?: string }) => post(`/reschedules/${id}/${action}`, { note }), onSuccess: refresh });
  const c = (value: string | null | undefined) => money(schedule.currencyCode, value);
  const term = schedule.paymentTerm;
  return (
    <div className="flex flex-col gap-4">
      <ProcPanel title="Payment terms" description="The terms the bill was posted with, kept as they were; changing the master never moves them.">
        <ProcFacts columns={3} items={[
          { label: "Payment term", value: term ? `${term.name}${term.version > 1 ? ` (v${term.version})` : ""}` : "—" },
          { label: "Rule", value: term?.summary ?? "—" },
          { label: "Invoice date / received / posted", value: `${calendarDate(schedule.invoiceDate)} / ${schedule.invoiceReceivedDate ? calendarDate(schedule.invoiceReceivedDate) : "—"} / ${calendarDate(schedule.postingDate)}` },
          ...(schedule.supplierStatedTerms ? [{ label: "Terms on the supplier's invoice", value: schedule.supplierStatedTerms }] : []),
          ...(schedule.paymentTermChangeReason ? [{ label: "Why the agreed terms were changed", value: schedule.paymentTermChangeReason }] : []),
        ]} />
      </ProcPanel>
      <ProcPanel title="Payment schedule" description="One payable, due in these parts. What remains of each part is what Finance's payments, advances and credits left — the oldest due first.">
        {!schedule.totals.reconciled && <ProcAlert tone="warning">The instalments ({c(schedule.totals.outstanding)}) do not add up to what Accounts Payable says is owed ({c(schedule.totals.billOutstanding)}).</ProcAlert>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-text-muted">{["#", "Due date", "Counted from", "Scheduled", "Settled", "Outstanding", "Status", ""].map((name, index) =>
              <th key={index} className={index >= 3 && index <= 5 ? "py-1 pr-3 text-right font-normal" : "py-1 pr-3 font-normal"}>{name}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {schedule.installments.map((row) => (
                <tr key={row.id}>
                  <td className="py-2 pr-3">{row.installment}{row.percentage ? <span className="block text-xs text-text-muted">{Number(row.percentage)}%</span> : null}</td>
                  <td className="py-2 pr-3">{calendarDate(row.dueDate)}{row.rescheduled && <span className="block text-xs text-text-muted">originally {calendarDate(row.originalDueDate)}</span>}</td>
                  <td className="py-2 pr-3">{row.basis ? BASIS[row.basis] ?? row.basis : "—"}{row.referenceDate && <span className="block text-xs text-text-muted">{calendarDate(row.referenceDate)}</span>}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{c(row.scheduled)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{c(row.settled)}</td>
                  <td className="py-2 pr-3 text-right font-medium tabular-nums">{c(row.outstanding)}</td>
                  <td className="py-2 pr-3"><StatusBadge tone={STATE_TONE[row.state] ?? "neutral"}>{statusLabel(row.state)}</StatusBadge></td>
                  <td className="py-2 pr-3 text-right">{schedule.actions.requestReschedule && Number(row.outstanding) > 0 && !row.pendingReschedule
                    && <Button size="compact" variant="ghost" onPress={() => setRequesting(row.id)}>Request reschedule</Button>}
                    {row.pendingReschedule && <span className="text-xs text-text-muted">Reschedule awaiting approval</span>}</td>
                </tr>
              ))}
              <tr className="font-medium"><td className="py-2 pr-3" colSpan={3}>Total</td><td className="py-2 pr-3 text-right tabular-nums">{c(schedule.totals.scheduled)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{c(schedule.totals.settled)}</td><td className="py-2 pr-3 text-right tabular-nums">{c(schedule.totals.outstanding)}</td><td colSpan={2} /></tr>
            </tbody>
          </table>
        </div>
      </ProcPanel>
      {schedule.reschedules.length > 0 && (
        <ProcPanel title="Reschedules">
          {decide.error && <ProcAlert>{decide.error instanceof Error ? decide.error.message : "Could not decide the reschedule."}</ProcAlert>}
          <ul className="flex flex-col divide-y divide-border text-sm">
            {schedule.reschedules.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{calendarDate(entry.previousDueDate)} → {calendarDate(entry.requestedDueDate)} · {statusLabel(entry.status)}
                  <span className="block text-xs text-text-muted">{entry.reason} — {entry.requestedBy ?? "—"}, {dateTime(entry.requestedAt)}{entry.decidedBy ? ` · decided by ${entry.decidedBy}` : ""}{entry.decisionNote ? `: ${entry.decisionNote}` : ""}</span></span>
                {entry.canDecide && <span className="flex gap-1">
                  <Button size="compact" variant="secondary" isLoading={decide.isPending} onPress={() => decide.mutate({ id: entry.id, action: "approve" })}>Approve</Button>
                  <Button size="compact" variant="ghost" onPress={() => { setNote(""); setRejecting(entry.id); }}>Reject</Button>
                </span>}
              </li>
            ))}
          </ul>
        </ProcPanel>
      )}
      {schedule.compliance.length > 0 && (
        <ProcPanel title="Statutory payment deadlines (MSMED Act)" description="For a micro or small supplier: payment within the written agreement's days (at most 45) or 15 days from acceptance. Separate from the commercial schedule; a reschedule never moves it.">
          <ul className="flex flex-col divide-y divide-border text-sm">
            {schedule.compliance.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><span className="font-medium">Pay by {calendarDate(entry.statutoryDueDate)}</span> · {entry.sourceReference} · accepted {calendarDate(entry.acceptanceDate)} ({statusLabel(entry.acceptanceBasis)})
                  <span className="block text-xs text-text-muted">{entry.statutoryDays} days ({entry.agreementBasis === "written_agreement" ? `written agreement of ${entry.agreedDays} days` : "no written agreement"}) · {c(entry.amount)}, {c(entry.outstanding)} outstanding
                    {entry.disputeReference ? ` · objection ${entry.disputeReference}` : ""}</span></span>
                <span className="flex items-center gap-2"><StatusBadge tone={STATE_TONE[entry.compliance] ?? "neutral"}>{statusLabel(entry.compliance)}</StatusBadge>
                  {entry.status === "open" && <Button size="compact" variant="ghost" onPress={() => setDisputing(entry.id)}>Record objection</Button>}</span>
              </li>
            ))}
          </ul>
        </ProcPanel>
      )}
      {rejecting && (
        <Dialog isOpen onOpenChange={(open) => !open && setRejecting(null)} title="Reject the reschedule" size="md">
          <div className="flex flex-col gap-3">
            <TextArea label="Reason" value={note} onChange={setNote} />
            <div className="flex justify-end gap-2"><Button variant="secondary" onPress={() => setRejecting(null)}>Close</Button>
              <Button variant="primary" isLoading={decide.isPending} isDisabled={note.trim().length < 3} onPress={() => decide.mutate({ id: rejecting, action: "reject", note }, { onSuccess: () => setRejecting(null) })}>Reject</Button></div>
          </div>
        </Dialog>
      )}
      {requesting && <RescheduleDialog billId={schedule.billId} scheduleId={requesting} onClose={() => setRequesting(null)} onDone={() => { setRequesting(null); refresh(); }} />}
      {disputing && <DisputeDialog deadlineId={disputing} onClose={() => setDisputing(null)} onDone={() => { setDisputing(null); refresh(); }} />}
    </div>
  );
}

function RescheduleDialog({ billId, scheduleId, onClose, onDone }: { billId: string; scheduleId: string; onClose: () => void; onDone: () => void }) {
  const [values, setValues] = useState({ newDueDate: "", reason: "" });
  const run = useMutation({ mutationFn: () => post(`/${billId}/reschedules`, { scheduleId, ...values }), onSuccess: onDone });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Request a reschedule" description="Finance approves it (not whoever requests it). The original due date is kept; the statutory deadline does not move." size="md">
      <div className="flex flex-col gap-3">
        {run.error && <ProcAlert>{run.error instanceof Error ? run.error.message : "Could not request the reschedule."}</ProcAlert>}
        <TextField label="New due date" type="date" value={values.newDueDate} onChange={(value) => setValues((current) => ({ ...current, newDueDate: value }))} />
        <TextArea label="Reason (the supplier's agreement and its reference)" value={values.reason} onChange={(value) => setValues((current) => ({ ...current, reason: value }))} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" isLoading={run.isPending} isDisabled={!values.newDueDate || values.reason.trim().length < 10} onPress={() => run.mutate()}>Request</Button></div>
      </div>
    </Dialog>
  );
}

function DisputeDialog({ deadlineId, onClose, onDone }: { deadlineId: string; onClose: () => void; onDone: () => void }) {
  const [values, setValues] = useState({ reference: "", raisedOn: "", resolvedOn: "", state: "open" });
  const run = useMutation({ mutationFn: () => post(`/compliance/${deadlineId}/dispute`, { reference: values.reference, raisedOn: values.raisedOn || undefined,
    resolvedOn: values.state === "resolved" ? values.resolvedOn : undefined }), onSuccess: onDone });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Record an objection to the goods or services" description="A documented objection. Once it is resolved, the statutory deadline counts from the day it was resolved." size="md">
      <div className="flex flex-col gap-3">
        {run.error && <ProcAlert>{run.error instanceof Error ? run.error.message : "Could not record the objection."}</ProcAlert>}
        <TextField label="Objection reference" value={values.reference} onChange={(value) => setValues((current) => ({ ...current, reference: value }))} />
        <TextField label="Raised on" type="date" value={values.raisedOn} onChange={(value) => setValues((current) => ({ ...current, raisedOn: value }))} />
        <Select label="State" selectedKey={values.state} onSelectionChange={(value) => setValues((current) => ({ ...current, state: String(value) }))}
          options={[{ value: "open", label: "Still open" }, { value: "resolved", label: "Resolved" }]} />
        {values.state === "resolved" && <TextField label="Resolved on" type="date" value={values.resolvedOn} onChange={(value) => setValues((current) => ({ ...current, resolvedOn: value }))} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" isLoading={run.isPending} isDisabled={values.reference.trim().length < 3 || (values.state === "resolved" && !values.resolvedOn)} onPress={() => run.mutate()}>Record</Button></div>
      </div>
    </Dialog>
  );
}
