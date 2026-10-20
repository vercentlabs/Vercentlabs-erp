"use client";

// One expense through its life: a draft (edit, attach the receipt, submit), awaiting approval (the approver sees the receipt and approves —
// which posts it — or sends it back with why; never the person who submitted it, nor the employee being reimbursed), still owed (pay it),
// paid, and corrected (cancelled before posting, reversed after, each with a reason). Similar expenses are pointed out, and every step is
// on the trail.
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Paperclip, Trash2 } from "lucide-react";
import { Breadcrumb, Button, Dialog, ErrorState, LinkButton, PermissionState, RecordDetailsPage, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { FactList, HistoryList, MoreActions, byLine } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  EXPENSE_STATE, GST_TREATMENTS, PAYMENT_METHODS, errorMessage, errorStatus, expenseFileHref, expenseOptions, expenseStep, getExpense, inr, methodLabel, removeExpenseFile, uploadExpenseFile,
  type ExpenseRecord, type ExpenseStep,
} from "../api/expenses-api";

export function ExpenseDetailScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "expense", id), queryFn: () => getExpense(id), retry: false });
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(params.get("problem") ? { tone: "warning", text: `Saved as a draft, but not submitted: ${params.get("problem")}` } : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<null | "reject" | "cancel" | "reverse" | "pay">(null);
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  if (query.isLoading) return <LoadingState label="Loading the expense" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the expense" description={errorMessage(query.error)} />;
  }
  const expense = query.data;
  const state = EXPENSE_STATE[expense.state];
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") });
  const run = async (step: ExpenseStep, done: string, input: Record<string, string> = {}) => {
    setBusy(step);
    setMessage(null);
    try { await expenseStep(expense.id, step, input); await refresh(); setMessage({ tone: "success", text: done }); }
    catch (error) { setMessage({ tone: "danger", text: errorMessage(error) }); } finally { setBusy(null); }
  };
  const mayManage = can("accounting.payables.manage");
  const mayApprove = can("accounting.payables.approve");
  const open = ["DRAFT", "REJECTED"].includes(expense.status);
  const mine = expense.submittedById === workspace.userId || expense.claimant?.id === workspace.userId;
  const primary = (
    <>
      {open && mayManage && <LinkButton variant="secondary" href={`/accounting/expenses/${expense.id}/edit`}>Edit</LinkButton>}
      {open && mayManage && <Button variant="primary" isLoading={busy === "submit"} isDisabled={Boolean(busy) || !expense.evidence.satisfied}
        onPress={() => run("submit", "Submitted.")}>Submit</Button>}
      {expense.status === "SUBMITTED" && expense.canApprove && <>
        <Button variant="secondary" isDisabled={Boolean(busy)} onPress={() => setAsk("reject")}>Send back</Button>
        <Button variant="primary" isLoading={busy === "approve"} isDisabled={Boolean(busy)} onPress={() => run("approve", "Approved and posted.")}>Approve</Button></>}
      {expense.state === "TO_PAY" && can("accounting.payments.manage") && <Button variant="primary" onPress={() => setAsk("pay")}>Pay</Button>}
    </>
  );

  return (
    <>
      <RecordDetailsPage
        header={{
          breadcrumbs: [<Breadcrumb key="list" href="/accounting/expenses">Expenses</Breadcrumb>, <Breadcrumb key="this" isCurrent>{expense.number}</Breadcrumb>],
          title: expense.description,
          status: <StatusBadge tone={state.tone}>{state.label}</StatusBadge>,
          fields: [
            { label: "Expense", value: expense.number }, { label: "Date", value: formatDate(expense.date) },
            { label: "Category", value: expense.category?.name ?? "—" }, { label: "Total", value: inr(expense.total, expense.currency) },
          ],
          primaryAction: primary,
          secondaryActions: <MoreActions actions={[
            { id: "journal", label: "Open the journal entry", run: () => router.push(`/accounting/journals/${expense.journalEntryId}`), show: Boolean(expense.journalEntryId) },
            { id: "cancel", label: "Cancel expense", run: () => setAsk("cancel"), show: ["DRAFT", "REJECTED", "SUBMITTED"].includes(expense.status) && mayManage },
            { id: "reverse", label: "Reverse expense", run: () => setAsk("reverse"), show: expense.status === "POSTED" && mayApprove },
          ]} />,
        }}
        sidebar={<HistoryList title="Audit trail" entries={expense.history.map((entry) => ({ summary: entry.label, at: entry.at, actor: entry.actor, detail: entry.detail ?? undefined }))} />}
      >
        <div className="flex flex-col gap-4">
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          {expense.status === "REJECTED" && <Notice tone="warning">Sent back: {expense.rejectionReason}. Edit it and submit again, or cancel it.</Notice>}
          {expense.status === "SUBMITTED" && !expense.canApprove && (
            <Notice tone="info">{mine ? "Waiting for someone else to approve it — you can't approve an expense you submitted or are being reimbursed for." : "Waiting for approval by someone who approves expenses."}</Notice>
          )}
          {open && !expense.evidence.satisfied && <Notice tone="warning">Attach the receipt (or say why there is none — Edit) before submitting.</Notice>}
          {expense.status === "CANCELLED" && <Notice tone="neutral">Cancelled{expense.cancelledBy ? ` by ${expense.cancelledBy}` : ""}: {expense.cancelReason ?? "—"}. It never posted.</Notice>}
          {expense.status === "REVERSED" && <Notice tone="danger">Reversed{expense.reversedBy ? ` by ${expense.reversedBy}` : ""}: {expense.reversalReason}.
            {expense.reversalJournalEntryId && <> <Link className="underline" href={`/accounting/journals/${expense.reversalJournalEntryId}`}>Reversing entry</Link>.</>}</Notice>}
          {expense.similar.length > 0 && !["CANCELLED", "REVERSED"].includes(expense.status) && (
            <Notice tone="warning">Possibly entered twice — same payee and amount within a week: {expense.similar.map((entry, index) => (
              <span key={entry.id}>{index > 0 ? ", " : ""}<Link className="underline" href={`/accounting/expenses/${entry.id}`}>{entry.number}</Link> ({formatDate(entry.date)})</span>))}.</Notice>
          )}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Metric label="Amount" value={inr(expense.amount, expense.currency)} />
            <Metric label={expense.gstTreatment === "NO_GST" ? "GST" : `GST ${expense.gstRate}%${expense.gstTreatment === "GST_CLAIM_ITC" ? " (credit)" : ""}`} value={inr(expense.taxAmount, expense.currency)} />
            <Metric label={expense.state === "TO_PAY" ? "Still owed" : "Total"} value={inr(expense.total, expense.currency)} warn={expense.state === "TO_PAY"} />
          </div>
          <FactList items={[
            ["Paid to", expense.payee ?? "—"], ["Bill / invoice no.", expense.supplierInvoiceReference ?? "—"], ["Supplier GSTIN", expense.supplierGstin ?? "—"],
            ["GST", GST_TREATMENTS.find(([value]) => value === expense.gstTreatment)?.[1] ?? "—"],
            ["Paid by", expense.claimant ? `${expense.claimant.name} (to reimburse)` : expense.settlement === "PAID" ? "The company" : "Not paid yet"],
            ["Paid from", expense.paidFrom ? `${expense.paidFrom.label} · ${methodLabel(expense.paymentMethod)}` : "—"],
            ["Posts to", expense.expenseAccount.label], ["Department", expense.department?.name ?? "—"], ["Cost centre", expense.costCenter?.name ?? "—"],
            ["Recorded", byLine(expense.createdAt, expense.createdBy) ?? "—"], ["Approved", byLine(expense.approvedAt, expense.approvedBy) ?? "—"],
            ["Entries", <span key="j" className="flex flex-wrap gap-x-3">
              {expense.journalEntryId ? <Link className="text-brand underline" href={`/accounting/journals/${expense.journalEntryId}`}>{expense.journalNumber ?? "Expense"}</Link> : "Not posted"}
              {expense.paymentJournalEntryId && <Link className="text-brand underline" href={`/accounting/journals/${expense.paymentJournalEntryId}`}>Payment {expense.paymentJournalNumber}</Link>}</span>],
            ["Notes", expense.notes ?? "—"],
          ]} />
          <EvidencePanel expense={expense} mayManage={mayManage || mayApprove} onChanged={refresh} onError={(text) => setMessage({ tone: "danger", text })} />
        </div>
      </RecordDetailsPage>
      {(ask === "reject" || ask === "cancel" || ask === "reverse") && (
        <ReasonDialog
          title={ask === "reject" ? "Send back" : ask === "cancel" ? `Cancel ${expense.number}` : `Reverse ${expense.number}`}
          action={ask === "reject" ? "Send back" : ask === "cancel" ? "Cancel expense" : "Reverse expense"}
          description={ask === "reject" ? "Say what to correct; the person who recorded it sees this."
            : ask === "cancel" ? "It never posts; it is kept, marked cancelled, with the reason."
            : "For an expense recorded in error. Its payment and the expense itself are reversed; both stay on record."}
          onClose={() => setAsk(null)}
          run={async (reason) => {
            await expenseStep(expense.id, ask, { reason });
            await refresh();
            setAsk(null);
            setMessage({ tone: "success", text: ask === "reject" ? "Sent back." : ask === "cancel" ? "Cancelled." : "Reversed." });
          }} />
      )}
      {ask === "pay" && <PayDialog expense={expense} onClose={() => setAsk(null)} onDone={async () => { await refresh(); setAsk(null); setMessage({ tone: "success", text: "Paid." }); }} />}
    </>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 rounded-[var(--radius-panel)] border p-2 sm:p-3 ${warn ? "border-warning-emphasis/30 bg-warning-soft" : "border-border bg-surface"}`}>
      <span className="truncate text-xs text-text-muted">{label}</span><span className="truncate text-sm font-semibold tabular-nums text-text sm:text-base">{value}</span>
    </div>
  );
}

function EvidencePanel({ expense, mayManage, onChanged, onError }: { expense: ExpenseRecord; mayManage: boolean; onChanged: () => Promise<unknown>; onError: (text: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const removable = ["DRAFT", "REJECTED"].includes(expense.status);
  const canAdd = mayManage && !["CANCELLED", "REVERSED"].includes(expense.status);
  const add = async (files: File[]) => {
    setUploading(true);
    try { for (const file of files) await uploadExpenseFile(expense.id, file); await onChanged(); } catch (error) { onError(errorMessage(error)); } finally { setUploading(false); }
  };
  return (
    <Panel title="Receipt and bill" description={expense.evidence.needed ? "The evidence for this expense. Files stay with it once it is submitted." : "Not needed for this amount; attach it if you have it."}>
      <div className="flex flex-col gap-3">
        {expense.fileList.length === 0 && !expense.noReceiptReason && <p className="text-sm text-text-muted">Nothing attached.</p>}
        {expense.fileList.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {expense.fileList.map((file) => (
              <li key={file.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <a className="flex min-w-0 items-center gap-2 text-brand underline" href={expenseFileHref(expense.id, file.id)} target="_blank" rel="noreferrer">
                  {file.mimeType.startsWith("image/") ? <Paperclip className="size-4 shrink-0" aria-hidden="true" /> : <FileText className="size-4 shrink-0" aria-hidden="true" />}
                  <span className="truncate">{file.fileName}</span></a>
                <span className="flex items-center gap-2 text-xs text-text-muted">{Math.max(1, Math.round(file.sizeBytes / 1024))} KB
                  {removable && mayManage && <Button size="compact" variant="ghost" aria-label={`Remove ${file.fileName}`}
                    onPress={async () => { try { await removeExpenseFile(expense.id, file.id); await onChanged(); } catch (error) { onError(errorMessage(error)); } }}><Trash2 className="size-3.5" /></Button>}</span>
              </li>
            ))}
          </ul>
        )}
        {expense.noReceiptReason && <Notice tone="neutral">No receipt — declared: {expense.noReceiptReason}</Notice>}
        {canAdd && (
          <label className="flex flex-col gap-1 text-sm"><span className="font-medium text-text">{uploading ? "Uploading…" : "Add files"}</span>
            <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,application/pdf,.doc,.docx,.xls,.xlsx" aria-label="Add receipt files" disabled={uploading}
              className="rounded-[var(--radius-control)] border border-border bg-surface px-2 py-1.5 text-sm"
              onChange={(event) => { const chosen = Array.from(event.target.files ?? []); event.target.value = ""; if (chosen.length) void add(chosen); }} /></label>
        )}
      </div>
    </Panel>
  );
}

function PayDialog({ expense, onClose, onDone }: { expense: ExpenseRecord; onClose: () => void; onDone: () => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "expense-options"), queryFn: expenseOptions });
  const [accountId, setAccountId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const today = options.data?.today ?? "";
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => !open && onClose()} title={`Pay ${inr(expense.total, expense.currency)}`}
      description={expense.claimant ? `Reimburses ${expense.claimant.name}.` : `Pays ${expense.payee ?? "the payee"}.`}>
      <div className="flex flex-col gap-3">
        {failure && <Notice>{failure}</Notice>}
        <Select label="Paid from" isRequired placeholder="Cash or bank account" selectedKey={accountId} onSelectionChange={(key) => setAccountId(String(key))}
          options={(options.data?.accounts ?? []).map((entry) => ({ value: entry.id, label: entry.cash ? `${entry.label} (cash)` : entry.label }))} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Date paid" type="date" value={date || today} onChange={setDate} />
          <Select label="How" selectedKey={method} onSelectionChange={(key) => setMethod(String(key))} options={PAYMENT_METHODS.map(([value, label]) => ({ value, label }))} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={!accountId || busy} onPress={async () => {
            setBusy(true); setFailure(null);
            try { await expenseStep(expense.id, "pay", { paidFromAccountId: accountId!, date: date || today, paymentMethod: method }); await onDone(); }
            catch (error) { setFailure(errorMessage(error)); } finally { setBusy(false); }
          }}>Record payment</Button>
        </div>
      </div>
    </Dialog>
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
          <Button variant="secondary" onPress={onClose}>Back</Button>
          <Button variant="danger" isLoading={busy} isDisabled={reason.trim().length < 3 || busy}
            onPress={async () => { setBusy(true); setFailure(null); try { await run(reason.trim()); } catch (error) { setFailure(errorMessage(error)); } finally { setBusy(false); } }}>{action}</Button>
        </div>
      </div>
    </Dialog>
  );
}
