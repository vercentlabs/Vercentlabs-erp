"use client";

// One supplier payment through its life: awaiting approval (the approver sees the amount, the account and the bills it pays, and approves
// or sends it back — never the person who prepared it), approved (posted, which applies its bills), posted (what it settled; each
// application can be undone with a reason), money not yet applied (an advance) with the supplier's open bills, reversed or discarded.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Breadcrumb, Button, Dialog, ErrorState, PermissionState, RecordDetailsPage, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable, MoreActions, byLine } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  PAYMENT_STATUS, cents, errorMessage, errorStatus, fromCents, getPayment, inr, methodLabel, paymentStep, undoPaymentAllocation, type PaymentRecord, type PaymentStep,
} from "../api/payables-api";

export function PaymentDetailScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "payment", id), queryFn: () => getPayment(id), retry: false });
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState<PaymentStep | null>(null);
  const [ask, setAsk] = useState<null | { kind: "discard" | "reverse" } | { kind: "undo"; allocation: PaymentRecord["allocations"][number] }>(null);
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  if (query.isLoading) return <LoadingState label="Loading the payment" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the payment" description={errorMessage(query.error)} />;
  }
  const payment = query.data;
  const status = PAYMENT_STATUS[payment.status];
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") });
  const run = async (step: PaymentStep, input: Record<string, unknown> = {}, done = "") => {
    setBusy(step);
    setMessage(null);
    try { await paymentStep(payment.id, step, input); await refresh(); if (done) setMessage({ tone: "success", text: done }); }
    catch (error) { setMessage({ tone: "danger", text: errorMessage(error) }); } finally { setBusy(null); }
  };
  const preparedByMe = payment.submittedById === workspace.userId;
  const mayManage = can("accounting.payments.manage");
  const mayApprove = can("accounting.payments.approve");
  const live = ["posted", "partially_applied", "applied"].includes(payment.status);
  const primary = (
    <>
      {payment.status === "pending_approval" && mayApprove && !preparedByMe && <>
        <Button variant="secondary" isLoading={busy === "reject"} isDisabled={Boolean(busy)} onPress={() => run("reject", {}, "Sent back to the person who prepared it.")}>Send back</Button>
        <Button variant="primary" isLoading={busy === "approve"} isDisabled={Boolean(busy)} onPress={() => run("approve", { contentHash: payment.contentHash }, "Approved. It can be posted now.")}>Approve</Button></>}
      {payment.status === "approved" && mayManage && <Button variant="primary" isLoading={busy === "post"} isDisabled={Boolean(busy)} onPress={() => run("post", {}, "Posted and applied to its bills.")}>Post payment</Button>}
      {payment.status === "draft" && mayManage && <Button variant="primary" isLoading={busy === "resubmit"} isDisabled={Boolean(busy)} onPress={() => run("resubmit", {}, "Sent for approval again.")}>Send again</Button>}
    </>
  );

  return (
    <>
      <RecordDetailsPage
        header={{
          breadcrumbs: [<Breadcrumb key="list" href="/accounting/payments">Supplier payments</Breadcrumb>, <Breadcrumb key="this" isCurrent>{payment.number}</Breadcrumb>],
          title: `Payment ${payment.number}`,
          status: <StatusBadge tone={status.tone}>{status.label}</StatusBadge>,
          fields: [
            { label: "Supplier", value: <Link className="text-brand underline" href={`/accounting/statements/supplier/${payment.partyId}`}>{payment.party}</Link> },
            { label: "Date", value: formatDate(payment.date) },
            { label: "Amount", value: inr(payment.amount, payment.currency) },
          ],
          primaryAction: primary,
          secondaryActions: <MoreActions actions={[
            { id: "statement", label: "Supplier statement", run: () => router.push(`/accounting/statements/supplier/${payment.partyId}`) },
            { id: "discard", label: "Discard", run: () => setAsk({ kind: "discard" }), show: payment.status === "draft" && mayManage },
            { id: "reverse", label: "Reverse payment", run: () => setAsk({ kind: "reverse" }), show: live && mayApprove },
          ]} />,
        }}
        sidebar={<HistoryList title="Audit trail" entries={payment.history.map((entry) => ({ summary: entry.label, at: entry.at, actor: entry.actor, detail: entry.detail ?? undefined }))} />}
      >
        <div className="flex flex-col gap-4">
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          {payment.status === "pending_approval" && preparedByMe && <Notice tone="info">Waiting for someone else to approve it — the person who prepares a payment can&apos;t approve it.</Notice>}
          {payment.status === "pending_approval" && !mayApprove && !preparedByMe && <Notice tone="info">Waiting for approval by someone who approves supplier payments.</Notice>}
          {payment.status === "draft" && <Notice tone="warning">Sent back by the approver. Send it again as it is, or discard it and prepare a new one with the changes.</Notice>}
          {payment.status === "cancelled" && <Notice tone="neutral">Discarded: {payment.cancelReason}. It never posted.</Notice>}
          {payment.status === "reversed" && <Notice tone="danger">Reversed: {payment.reversalReason}. The bills it paid are owed again.
            {payment.reversalJournalEntryId && <> <Link className="underline" href={`/accounting/journals/${payment.reversalJournalEntryId}`}>Reversing entry</Link>.</>}</Notice>}
          {live && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Metric label="Paid" value={inr(payment.amount, payment.currency)} />
              <Metric label="Applied to bills" value={inr(payment.applied, payment.currency)} />
              <Metric label="Not yet applied (advance)" value={inr(payment.unapplied, payment.currency)} warn={payment.unapplied > 0} />
            </div>
          )}
          <FactList items={[
            ["How", methodLabel(payment.method)], ["Reference", payment.reference ?? "—"], ["Paid from", payment.account ?? "—"],
            ["Prepared", byLine(payment.createdAt, payment.createdBy) ?? "—"], ["Approved", byLine(payment.approvedAt, payment.approvedBy) ?? "—"],
            ["Journal", payment.journalEntryId ? <Link key="j" className="text-brand underline" href={`/accounting/journals/${payment.journalEntryId}`}>Open entry</Link> : "Not posted yet"],
            ["Notes", payment.notes ?? "—"],
          ]} />
          {!live && payment.plannedAllocations.length > 0 && (
            <Panel title="Bills this payment pays" description={payment.status === "pending_approval" ? "Approve the payment for these bills. Posting applies them." : "Applied when the payment is posted (each only for what it still owes then)."}>
              <LinesTable columns={["Bill", "Due", { label: "Still owed", numeric: true }, { label: "To pay", numeric: true }]}>
                {payment.plannedAllocations.map((entry) => (
                  <tr key={entry.billId}>
                    <Cell><Link className="text-brand underline" href={entry.href}>{entry.bill}</Link>{entry.supplierInvoice && <span className="block text-xs text-text-muted">Invoice {entry.supplierInvoice}</span>}</Cell>
                    <Cell>{formatDate(entry.dueDate)}</Cell>
                    <Cell numeric>{inr(entry.stillOwed, payment.currency)}</Cell>
                    <Cell numeric>{inr(entry.amount, payment.currency)}</Cell>
                  </tr>
                ))}
              </LinesTable>
              {payment.planned < payment.amount && <p className="mt-2 text-xs text-text-muted">{inr(payment.amount - payment.planned, payment.currency)} is not for a bill: it becomes an advance to the supplier.</p>}
            </Panel>
          )}
          {(live || payment.status === "reversed") && (
            <Panel title="Applied to" description="What this payment settled. An application to the wrong bill can be undone; it stays here, marked undone.">
              <LinesTable columns={["Bill", "Applied on", { label: "Amount", numeric: true }, ""]} empty={payment.allocations.length ? undefined : "Not applied to any bill yet."}>
                {payment.allocations.map((entry) => (
                  <tr key={entry.id} className={entry.undone ? "text-text-muted" : undefined}>
                    <Cell><Link className="text-brand underline" href={entry.href}>{entry.bill}</Link>
                      {entry.undone && <span className="block text-xs">Undone {formatDate(entry.undone.at)}{entry.undone.by ? ` by ${entry.undone.by}` : ""}: {entry.undone.reason}</span>}</Cell>
                    <Cell>{formatDate(entry.at)}{entry.by ? <span className="block text-xs text-text-muted">{entry.by}</span> : null}</Cell>
                    <Cell numeric><span className={entry.undone ? "line-through" : undefined}>{inr(entry.amount, payment.currency)}</span></Cell>
                    <Cell>{!entry.undone && live && mayManage && <Button size="compact" variant="ghost" onPress={() => setAsk({ kind: "undo", allocation: entry })}>Undo</Button>}</Cell>
                  </tr>
                ))}
              </LinesTable>
            </Panel>
          )}
          {live && payment.unapplied > 0 && mayManage && <ApplyPanel payment={payment} onDone={async (text) => { await refresh(); setMessage({ tone: "success", text }); }} onError={(text) => setMessage({ tone: "danger", text })} />}
        </div>
      </RecordDetailsPage>
      {ask?.kind === "undo" && (
        <ReasonDialog title={`Undo the application to ${ask.allocation.bill}`} action="Undo application"
          description={`${ask.allocation.bill} will be owed ${inr(ask.allocation.settled, payment.currency)} more again, and that money becomes unapplied on this payment.`}
          onClose={() => setAsk(null)}
          run={async (reason) => { await undoPaymentAllocation(ask.allocation.id, reason); await refresh(); setAsk(null); setMessage({ tone: "success", text: "Application undone." }); }} />
      )}
      {(ask?.kind === "discard" || ask?.kind === "reverse") && (
        <ReasonDialog title={ask.kind === "discard" ? `Discard ${payment.number}` : `Reverse ${payment.number}`} action={ask.kind === "discard" ? "Discard" : "Reverse payment"}
          description={ask.kind === "discard" ? "It is kept for the record, marked discarded, and never posts."
            : "For a payment that did not go through (a bounced cheque, a returned transfer). Its applications are undone and its entry reversed."}
          onClose={() => setAsk(null)}
          run={async (reason) => {
            await paymentStep(payment.id, ask.kind, { reason });
            await refresh();
            setAsk(null);
            setMessage({ tone: "success", text: ask.kind === "discard" ? "Discarded." : "Payment reversed." });
          }} />
      )}
    </>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`flex flex-col gap-0.5 rounded-[var(--radius-panel)] border p-3 ${warn ? "border-warning-emphasis/30 bg-warning-soft" : "border-border bg-surface"}`}>
      <span className="text-xs text-text-muted">{label}</span><span className="text-base font-semibold tabular-nums text-text">{value}</span>
    </div>
  );
}

function ApplyPanel({ payment, onDone, onError }: { payment: PaymentRecord; onDone: (text: string) => Promise<void>; onError: (text: string) => void }) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const entered = Object.values(amounts).reduce((sum, value) => sum + cents(value), 0);
  const left = cents(payment.unapplied) - entered;
  const apply = useMutation({
    mutationFn: () => paymentStep(payment.id, "apply", { allocations: Object.entries(amounts).filter(([, value]) => cents(value) > 0).map(([billId, value]) => ({ billId, amount: fromCents(cents(value)) })) }),
    onSuccess: async () => { setAmounts({}); await onDone("Applied."); }, onError: (error) => onError(errorMessage(error)),
  });
  const oldest = useMutation({ mutationFn: () => paymentStep(payment.id, "apply-oldest"), onSuccess: async () => onDone("Applied to the oldest bills."), onError: (error) => onError(errorMessage(error)) });
  return (
    <Panel title="Apply the rest" description={`${inr(payment.unapplied, payment.currency)} of this payment is not applied yet. Apply it to the supplier's open bills, or leave it as an advance.`}
      actions={payment.openBills.length > 0 ? <Button size="compact" variant="secondary" isLoading={oldest.isPending} onPress={() => oldest.mutate()}>Apply to oldest</Button> : undefined}>
      {payment.openBills.length === 0 ? <p className="text-sm text-text-muted">The supplier has no open bill in {payment.currency}; the money stays as an advance.</p> : (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col divide-y divide-border">
            {payment.openBills.map((bill) => (
              <li key={bill.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex flex-col text-sm"><span className="font-medium text-text">{bill.number}</span>
                  <span className={`text-xs ${bill.overdue ? "text-danger" : "text-text-muted"}`}>Due {formatDate(bill.dueDate)} · owed {inr(bill.outstanding, payment.currency)}</span></span>
                <TextField aria-label={`Apply to ${bill.number}`} size="compact" inputMode="decimal" className="w-36" placeholder="0.00" value={amounts[bill.id] ?? ""}
                  errorMessage={cents(amounts[bill.id]) > cents(bill.outstanding) ? "More than owed" : undefined} onChange={(value) => setAmounts((current) => ({ ...current, [bill.id]: value }))} />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`text-sm tabular-nums ${left < 0 ? "text-danger" : "text-text-secondary"}`}>{left < 0 ? `${inr(-left / 100)} more than is left` : `${inr(left / 100, payment.currency)} left after this`}</span>
            <Button size="compact" variant="primary" isLoading={apply.isPending} isDisabled={entered <= 0 || left < 0 || apply.isPending} onPress={() => apply.mutate()}>Apply</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function ReasonDialog({ title, description, action, onClose, run }: { title: string; description: string; action: string; onClose: () => void; run: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title} description={description}>
      <div className="flex flex-col gap-3">
        {failure && <Notice>{failure}</Notice>}
        <TextArea label="Reason" isRequired value={reason} onChange={setReason} maxLength={500} description="Kept on record." />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="danger" isLoading={busy} isDisabled={reason.trim().length < 3 || busy}
            onPress={async () => { setBusy(true); setFailure(null); try { await run(reason.trim()); } catch (error) { setFailure(errorMessage(error)); } finally { setBusy(false); } }}>{action}</Button>
        </div>
      </div>
    </Dialog>
  );
}
