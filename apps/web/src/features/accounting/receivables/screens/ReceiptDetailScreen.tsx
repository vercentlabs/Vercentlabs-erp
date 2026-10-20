"use client";

// One customer receipt: how much, how it arrived, what it settled (each application can be undone, with a reason, and stays on record),
// the money still unapplied (an advance) with the customer's open invoices it can settle, and its trail. A receipt that did not happen
// (a bounced cheque) is reversed: its applications are undone and its entry reversed.
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

import { RECEIPT_STATUS, cents, errorMessage, errorStatus, fromCents, getReceipt, inr, methodLabel, receiptStep, undoAllocation, type ReceiptRecord } from "../api/receivables-api";

export function ReceiptDetailScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "receipt", id), queryFn: () => getReceipt(id), retry: false });
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [undoing, setUndoing] = useState<ReceiptRecord["allocations"][number] | null>(null);
  const [reversing, setReversing] = useState(false);
  const may = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("accounting.receipts.manage");
  if (query.isLoading) return <LoadingState label="Loading the receipt" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the receipt" description={errorMessage(query.error)} />;
  }
  const receipt = query.data;
  const status = RECEIPT_STATUS[receipt.status] ?? { label: receipt.status, tone: "neutral" as const };
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") });
  const live = receipt.allocations.filter((entry) => !entry.undone);
  const canApply = may && ["posted", "partially_applied"].includes(receipt.status) && receipt.unapplied > 0;

  return (
    <>
      <RecordDetailsPage
        header={{
          breadcrumbs: [<Breadcrumb key="list" href="/accounting/receipts">Receipts</Breadcrumb>, <Breadcrumb key="this" isCurrent>{receipt.number}</Breadcrumb>],
          title: `Receipt ${receipt.number}`,
          status: <StatusBadge tone={status.tone}>{status.label}</StatusBadge>,
          fields: [
            { label: "Customer", value: <Link className="text-brand underline" href={`/accounting/statements/customer/${receipt.partyId}`}>{receipt.party}</Link> },
            { label: "Received", value: formatDate(receipt.date) },
            { label: "Amount", value: inr(receipt.amount, receipt.currency) },
          ],
          secondaryActions: <MoreActions actions={[
            { id: "statement", label: "Customer statement", run: () => router.push(`/accounting/statements/customer/${receipt.partyId}`) },
            { id: "reverse", label: "Reverse receipt", run: () => { setMessage(null); setReversing(true); }, show: may && ["posted", "partially_applied", "applied"].includes(receipt.status) },
          ]} />,
        }}
        sidebar={<HistoryList title="Audit trail" entries={receipt.history.map((entry) => ({ summary: entry.label, at: entry.at, actor: entry.actor, detail: entry.detail ?? undefined }))} />}
      >
        <div className="flex flex-col gap-4">
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          {receipt.status === "reversed" && <Notice tone="danger">Reversed{receipt.reversedAt ? ` on ${formatDate(receipt.reversedAt)}` : ""}: {receipt.reversalReason}. The invoices it settled are owed again.
            {receipt.reversalJournalEntryId && <> <Link className="underline" href={`/accounting/journals/${receipt.reversalJournalEntryId}`}>Reversing entry</Link>.</>}</Notice>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Metric label="Received" value={inr(receipt.amount, receipt.currency)} />
            <Metric label="Applied to invoices" value={inr(receipt.applied, receipt.currency)} />
            <Metric label="Not yet applied (advance)" value={inr(receipt.unapplied, receipt.currency)} tone={receipt.unapplied > 0 ? "warning" : undefined} />
          </div>
          <FactList items={[
            ["How", methodLabel(receipt.method)], ["Reference", receipt.reference ?? "—"], ["Received into", receipt.account ?? "—"],
            ["Recorded", byLine(receipt.createdAt, receipt.createdBy) ?? "—"],
            ["Journal", receipt.journalEntryId ? <Link key="j" className="text-brand underline" href={`/accounting/journals/${receipt.journalEntryId}`}>Open entry</Link> : "—"],
            ["Notes", receipt.notes ?? "—"],
          ]} />
          <Panel title="Applied to" description="What this payment settled. An application made to the wrong invoice can be undone; it stays here, marked undone.">
            <LinesTable columns={["Invoice", "Applied on", { label: "Amount", numeric: true }, ""]} empty={receipt.allocations.length ? undefined : "Not applied to any invoice yet."}>
              {receipt.allocations.map((entry) => (
                <tr key={entry.id} className={entry.undone ? "text-text-muted" : undefined}>
                  <Cell>{entry.href ? <Link className="text-brand underline" href={entry.href}>{entry.invoice}</Link> : entry.invoice}
                    {entry.undone && <span className="block text-xs">Undone {formatDate(entry.undone.at)}{entry.undone.by ? ` by ${entry.undone.by}` : ""}: {entry.undone.reason}</span>}
                    {(entry.discount > 0 || entry.writeoff > 0) && <span className="block text-xs text-text-muted">{entry.discount > 0 ? `Discount ${inr(entry.discount)} ` : ""}{entry.writeoff > 0 ? `Written off ${inr(entry.writeoff)}` : ""}</span>}</Cell>
                  <Cell>{formatDate(entry.at)}{entry.by ? <span className="block text-xs text-text-muted">{entry.by}</span> : null}</Cell>
                  <Cell numeric><span className={entry.undone ? "line-through" : undefined}>{inr(entry.amount, receipt.currency)}</span></Cell>
                  <Cell>{!entry.undone && may && receipt.status !== "reversed" && <Button size="compact" variant="ghost" onPress={() => { setMessage(null); setUndoing(entry); }}>Undo</Button>}</Cell>
                </tr>
              ))}
            </LinesTable>
            {live.length > 0 && <p className="mt-2 text-xs text-text-muted">{live.length} live application(s).</p>}
          </Panel>
          {canApply && <ApplyPanel receipt={receipt} onDone={async (text) => { setMessage({ tone: "success", text }); await refresh(); }} onError={(text) => setMessage({ tone: "danger", text })} />}
        </div>
      </RecordDetailsPage>
      {undoing && <ReasonDialog title={`Undo the application to ${undoing.invoice}`} action="Undo application"
        description={`${undoing.invoice} will owe ${inr(undoing.settled, receipt.currency)} more again, and that money becomes unapplied on this receipt.`}
        onClose={() => setUndoing(null)} run={async (reason) => { await undoAllocation(undoing.id, reason); await refresh(); setUndoing(null); setMessage({ tone: "success", text: `Application to ${undoing.invoice} undone.` }); }} />}
      {reversing && <ReasonDialog title={`Reverse ${receipt.number}`} action="Reverse receipt" withDate
        description="For a payment that did not happen (a bounced cheque, entered in error). Every application is undone and the entry is reversed; the receipt stays, marked reversed."
        onClose={() => setReversing(false)} run={async (reason, date) => { await receiptStep(receipt.id, "reverse", { reason, accountingDate: date || undefined }); await refresh(); setReversing(false); setMessage({ tone: "success", text: "Receipt reversed." }); }} />}
    </>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return (
    <div className={`flex flex-col gap-0.5 rounded-[var(--radius-panel)] border p-3 ${tone === "warning" ? "border-warning-emphasis/30 bg-warning-soft" : "border-border bg-surface"}`}>
      <span className="text-xs text-text-muted">{label}</span><span className="text-base font-semibold tabular-nums text-text">{value}</span>
    </div>
  );
}

function ApplyPanel({ receipt, onDone, onError }: { receipt: ReceiptRecord; onDone: (text: string) => Promise<void>; onError: (text: string) => void }) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const entered = Object.values(amounts).reduce((sum, value) => sum + cents(value), 0);
  const left = cents(receipt.unapplied) - entered;
  const apply = useMutation({
    mutationFn: () => receiptStep(receipt.id, "apply", { allocations: Object.entries(amounts).filter(([, value]) => cents(value) > 0).map(([invoiceId, value]) => ({ invoiceId, amount: fromCents(cents(value)) })) }),
    onSuccess: async () => { setAmounts({}); await onDone("Applied."); },
    onError: (error) => onError(errorMessage(error)),
  });
  const oldest = useMutation({ mutationFn: () => receiptStep(receipt.id, "apply-oldest"), onSuccess: async () => onDone("Applied to the oldest invoices."), onError: (error) => onError(errorMessage(error)) });
  return (
    <Panel title="Apply the rest" description={`${inr(receipt.unapplied, receipt.currency)} of this payment is not applied yet. Apply it to the customer's open invoices, or leave it as an advance.`}
      actions={receipt.openInvoices.length > 0 ? <Button size="compact" variant="secondary" isLoading={oldest.isPending} onPress={() => oldest.mutate()}>Apply to oldest</Button> : undefined}>
      {receipt.openInvoices.length === 0 ? <p className="text-sm text-text-muted">The customer has no open invoice in {receipt.currency}. The money stays as an advance until one is issued.</p> : (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col divide-y divide-border">
            {receipt.openInvoices.map((invoice) => (
              <li key={invoice.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex flex-col text-sm"><span className="font-medium text-text">{invoice.number}</span>
                  <span className={`text-xs ${invoice.overdue ? "text-danger" : "text-text-muted"}`}>Due {formatDate(invoice.dueDate)} · owes {inr(invoice.outstanding, receipt.currency)}</span></span>
                <TextField aria-label={`Apply to ${invoice.number}`} size="compact" inputMode="decimal" className="w-36" placeholder="0.00" value={amounts[invoice.id] ?? ""}
                  errorMessage={cents(amounts[invoice.id]) > cents(invoice.outstanding) ? "More than it owes" : undefined}
                  onChange={(value) => setAmounts((current) => ({ ...current, [invoice.id]: value }))} />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`text-sm tabular-nums ${left < 0 ? "text-danger" : "text-text-secondary"}`}>{left < 0 ? `${inr(-left / 100)} more than is left` : `${inr(left / 100, receipt.currency)} left after this`}</span>
            <Button size="compact" variant="primary" isLoading={apply.isPending} isDisabled={entered <= 0 || left < 0 || apply.isPending} onPress={() => apply.mutate()}>Apply</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function ReasonDialog({ title, description, action, withDate, onClose, run }: {
  title: string; description: string; action: string; withDate?: boolean; onClose: () => void; run: (reason: string, date?: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title} description={description}>
      <div className="flex flex-col gap-3">
        {failure && <Notice>{failure}</Notice>}
        {withDate && <TextField label="Reversal date" type="date" value={date} onChange={setDate} description="Today if empty; it must be in an open period." />}
        <TextArea label="Reason" isRequired value={reason} onChange={setReason} maxLength={500} description="Kept on record." />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="danger" isLoading={busy} isDisabled={reason.trim().length < 3 || busy}
            onPress={async () => { setBusy(true); setFailure(null); try { await run(reason.trim(), date); } catch (error) { setFailure(errorMessage(error)); } finally { setBusy(false); } }}>{action}</Button>
        </div>
      </div>
    </Dialog>
  );
}
