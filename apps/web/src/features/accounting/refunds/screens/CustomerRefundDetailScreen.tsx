"use client";

// One customer refund: the money flow at a glance (who, how much, from which
// credit, paid how and from which account, with what reference), and the
// actions open to the caller now (the server decides them and checks each
// again); then the credit it consumes, the payment details, the journal (for
// those who may see the books), the documents the credit comes from, notes
// and files, and the history. A Draft is edited and posted; a posted refund
// never changes: one entered in error is reversed.
import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Eye, Pencil, Send, Upload } from "lucide-react";
import {
  Button, ErrorState, LinkButton, MetricStrip, PermissionState, RecordDetailsPage, Tab, TabList, TabPanel, Tabs, buttonVariants,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { AccountingAlert, AccountingPanel } from "@/features/accounting/shared/AccountingUi";
import { AccountingApiError } from "@/features/accounting/shared/client";
import { calendarDate, dateTime, label as statusLabel, money } from "@/features/accounting/shared/format";

import { getRefund, listRefundFiles, refundFileUrl, refundVoucherUrl, removeRefundFile, uploadRefundFile, type RefundDetail, type RefundEvent } from "../api/refunds-api";
import {
  CancelRefundDialog, EditRefundDialog, MarkRefundSentDialog, PostRefundDialog, RefundStatusBadge, ReverseRefundDialog, SendRefundDialog, failureText,
} from "../components/RefundDialogs";

const by = (at: string | null, name: string | null) => (at ? `${dateTime(at)}${name ? ` by ${name}` : ""}` : "—");
type DialogKind = "edit" | "post" | "cancel" | "reverse" | "send" | "markSent" | null;

function Facts({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-0.5">
          <dt className="text-xs font-medium text-text-muted">{item.label}</dt>
          <dd className="text-sm text-text">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

const EVENT_LABELS: Record<string, string> = {
  "accounting.customer_refund.created": "Draft refund created", "accounting.customer_refund.updated": "Draft changed", "accounting.customer_refund.posted": "Refund posted",
  "accounting.customer_refund.cancelled": "Draft cancelled", "accounting.customer_refund.reversed": "Refund reversed", "accounting.customer_refund.sent": "Confirmation emailed",
  "accounting.customer_refund.marked_sent": "Confirmation marked as sent", "accounting.customer_refund.file_added": "File added", "accounting.customer_refund.file_removed": "File removed",
};
function eventDetail(event: RefundEvent) {
  const m = event.metadata ?? {};
  const text = (key: string) => (typeof m[key] === "string" && m[key] ? String(m[key]) : null);
  const changes = Array.isArray(m.changes) ? (m.changes as Array<Record<string, unknown>>).map((change) => `${change.what}: ${change.from ?? "none"} → ${change.to ?? "none"}`).join("\n") : null;
  return [text("source"), text("amount") && `${money(text("amount"))} ${text("currencyCode") ?? ""}`.trim(), text("paymentMethod"), text("reference") && `Ref ${text("reference")}`,
    text("creditLeft") && `Credit left ${money(text("creditLeft"))}`, text("creditRestored") && `Credit restored ${money(text("creditRestored"))}`,
    text("journalEntryNumber") && `Journal ${text("journalEntryNumber")}`, changes, text("channel"), text("recipient") && `To ${text("recipient")}`, text("fileName"), text("note"),
    text("reason")].filter(Boolean).join(" · ");
}

export function CustomerRefundDetailScreen({ refundId, basePath = "/accounting/customer-refunds" }: { refundId: string; basePath?: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "accounting", "customer-refund", refundId);
  const query = useQuery({ queryKey: key, queryFn: () => getRefund(refundId).then((r) => r.refund) });
  const [tab, setTab] = useState("overview");
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting", "customer-refunds") });
    if (query.data?.source.type === "credit_note") void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "credit-note", query.data.source.id) });
  };
  const done = (message?: string) => { setDialog(null); setNotice(message ?? null); refresh(); };

  if (query.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>;
  if (query.isError && query.error instanceof AccountingApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to customer refunds" description="Ask an administrator for the View customer refunds permission." />;
  if (query.isError || !query.data)
    return <ErrorState title={query.error instanceof AccountingApiError && query.error.status === 404 ? "Refund not found" : "Could not load this refund"}
      action={{ label: "Retry", onPress: () => query.refetch() }} />;

  const detail = query.data;
  const { refund, source, actions } = detail;
  const currency = refund.currency_code;
  const posted = refund.status === "posted";
  const sourceHref = source.type === "credit_note" && source.fromSales ? `/sales/credit-notes/${source.id}` : null;
  const sourceLink = sourceHref ? <Link className="hover:underline" href={sourceHref}>{source.number}</Link> : source.number;

  return (
    <div className="flex flex-col gap-4">
      <Link href={basePath} className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        All refunds
      </Link>
      {notice && <AccountingAlert tone="info" className="whitespace-pre-line">{notice}</AccountingAlert>}
      {refund.status === "reversed" && (
        <AccountingAlert tone="warning">This refund was reversed {by(refund.reversed_at, refund.reversed_by_name)}{refund.reversal_reason ? `: ${refund.reversal_reason}` : ""}. The credit is back on {source.number}; the refund is kept for the record.</AccountingAlert>
      )}
      {refund.status === "cancelled" && <AccountingAlert tone="warning">This draft was cancelled{refund.cancel_reason ? `: ${refund.cancel_reason}` : ""}. Nothing was paid.</AccountingAlert>}
      {refund.status === "draft" && <AccountingAlert tone="info">A draft has no financial effect: no credit is consumed and no money has left until it is posted.</AccountingAlert>}
      {refund.status === "draft" && detail.problems.filter((problem) => problem.field !== "bankAccountId").length > 0 && (
        <AccountingAlert tone="warning"><span className="font-medium">It cannot be posted yet:</span>
          <ul className="list-disc pl-4">{detail.problems.filter((problem) => problem.field !== "bankAccountId").map((problem, index) => <li key={index}>{problem.message}</li>)}</ul></AccountingAlert>
      )}
      {detail.warnings.map((warning, index) => <AccountingAlert key={index} tone="warning">{warning.message}</AccountingAlert>)}

      <RecordDetailsPage
        header={{
          title: refund.refund_number,
          status: <span className="flex flex-wrap gap-1"><RefundStatusBadge status={refund.status} label={refund.statusLabel} /></span>,
          fields: [
            { label: "Customer", value: refund.customer_name },
            { label: "Amount", value: `${money(refund.amount)} ${currency}` },
            { label: "Source", value: sourceLink },
            { label: "Method", value: refund.paymentMethodLabel },
            { label: "Bank / cash account", value: refund.bank_account_name ?? "Not chosen" },
            { label: "Reference", value: refund.external_reference ?? "—" },
          ],
          primaryAction: actions.post ? (
            <Button variant="primary" onPress={() => setDialog("post")}><Check className="size-4" aria-hidden="true" />Post Refund</Button>
          ) : actions.send ? (
            <Button variant="primary" onPress={() => setDialog("send")}><Send className="size-4" aria-hidden="true" />Send Confirmation</Button>
          ) : undefined,
          secondaryActions: (
            <div className="flex flex-wrap items-center gap-2">
              {actions.edit && <Button variant="secondary" onPress={() => setDialog("edit")}><Pencil className="size-4" aria-hidden="true" />Edit</Button>}
              {actions.print && <a className={buttonVariants({ variant: "secondary" })} href={refundVoucherUrl(refundId, true)} target="_blank" rel="noreferrer"><Eye className="size-4" aria-hidden="true" />{posted ? "View Voucher" : "Draft Voucher"}</a>}
              {actions.print && posted && <LinkButton variant="secondary" href={refundVoucherUrl(refundId)} download>Download</LinkButton>}
              {actions.markSent && <Button variant="secondary" onPress={() => setDialog("markSent")}>Mark as Sent</Button>}
              {actions.cancel && <Button variant="ghost" onPress={() => setDialog("cancel")}>Cancel Draft</Button>}
              {actions.reverse && <Button variant="ghost" onPress={() => setDialog("reverse")}>Reverse</Button>}
            </div>
          ),
        }}
      >
        <MetricStrip
          metrics={[
            { label: "Refund amount", value: `${money(refund.amount)} ${currency}` },
            ...(source.total !== null ? [{ label: `${source.typeLabel} amount`, value: money(source.total) }] : []),
            ...(source.refunded !== null ? [{ label: "Refunded so far", value: money(source.refunded) }] : []),
            ...(source.available !== null ? [{ label: "Credit left", value: money(source.available) }] : []),
          ]}
        />
        <Tabs selectedKey={tab} onSelectionChange={(selected) => setTab(String(selected))}>
          <TabList aria-label="Refund sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="source">Source / allocation</Tab>
            <Tab id="payment">Payment details</Tab>
            {actions.viewAccounting && <Tab id="accounting">Accounting</Tab>}
            <Tab id="related">Related documents</Tab>
            <Tab id="notes">Notes &amp; attachments</Tab>
            <Tab id="history">History</Tab>
          </TabList>
          <TabPanel id="overview">
            <div className="flex flex-col gap-4 pt-4">
              <AccountingPanel title="Refund">
                <Facts items={[
                  { label: "Customer", value: `${refund.customer_name}${refund.customer_number ? ` · ${refund.customer_number}` : ""}` },
                  { label: "Refund date", value: calendarDate(refund.refund_date) },
                  { label: "Amount", value: `${money(refund.amount)} ${currency}` },
                  { label: "Reason", value: [refund.reasonLabel, refund.reason_note].filter(Boolean).join(": ") },
                  { label: "Source", value: <>{source.typeLabel} {sourceLink}</> },
                  { label: "Confirmation", value: refund.sent ? `Sent ${dateTime(refund.sent_at)}${refund.sent_to ? ` to ${refund.sent_to}` : ""}` : "Not sent" },
                ]} />
              </AccountingPanel>
              <AccountingPanel title="Status history">
                <Facts items={[
                  { label: "Created", value: by(refund.created_at, refund.created_by_name) },
                  { label: "Posted", value: by(refund.posted_at, refund.posted_by_name) },
                  { label: "Reversed", value: by(refund.reversed_at, refund.reversed_by_name) },
                  ...(refund.cancelled_at ? [{ label: "Cancelled", value: by(refund.cancelled_at, refund.cancelled_by_name) }] : []),
                ]} />
              </AccountingPanel>
            </div>
          </TabPanel>
          <TabPanel id="source">
            <div className="flex flex-col gap-4 pt-4">
              <AccountingPanel title="Credit consumed" description="A refund consumes the customer's credit; it never changes the amount of the credit note, the receipt or the invoice.">
                <Facts items={[
                  { label: source.typeLabel, value: sourceLink },
                  { label: "Dated", value: calendarDate(source.date) },
                  { label: "This refund", value: `${money(refund.amount)} ${currency}${posted ? "" : refund.status === "draft" ? " (not consumed yet)" : " (not consumed)"}` },
                  ...(actions.viewCredit ? [
                    { label: `${source.typeLabel} amount`, value: money(source.total) },
                    { label: "Applied to invoices", value: money(source.applied) },
                    { label: "Refunded (posted refunds)", value: money(source.refunded) },
                    { label: "Credit left", value: money(source.available) },
                  ] : []),
                ]} />
              </AccountingPanel>
              <AccountingPanel title="Other refunds of this credit">
                {!detail.otherRefunds.length ? <p className="text-sm text-text-muted">None.</p> : (
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {detail.otherRefunds.map((other) => (
                      <li key={other.id} className="flex flex-wrap items-center gap-3 py-2">
                        <Link className="font-medium tabular-nums text-brand hover:underline" href={`${basePath}/${other.id}`}>{other.refund_number}</Link>
                        <RefundStatusBadge status={other.status} label={other.statusLabel} />
                        <span className="text-text-muted">{calendarDate(other.refund_date)}</span>
                        <span className="tabular-nums">{money(other.amount)} {currency}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </AccountingPanel>
            </div>
          </TabPanel>
          <TabPanel id="payment">
            <div className="pt-4">
              <AccountingPanel title="Payment details" description="How the money was paid, and from where. Recorded here; the payment itself is made at the bank.">
                <Facts items={[
                  { label: "Payment method", value: refund.paymentMethodLabel },
                  { label: "Bank / cash account", value: refund.bank_account_name ? `${refund.bank_account_name} · ${refund.bank_name ?? ""}${refund.masked_account_number ? ` ${refund.masked_account_number}` : ""}` : "Not chosen yet" },
                  { label: "Transaction reference", value: refund.external_reference ?? "—" },
                  { label: "Refund date", value: calendarDate(refund.refund_date) },
                  { label: "Currency", value: currency },
                ]} />
              </AccountingPanel>
            </div>
          </TabPanel>
          {actions.viewAccounting && (
            <TabPanel id="accounting">
              <div className="pt-4">
                <AccountingPanel title="Accounting" description="Posting debits the customer's account (the credit it carried is settled) and credits the bank or cash account. No revenue and no tax: the credit note already corrected them.">
                  <Facts items={[
                    { label: "Journal entry", value: refund.journal_entry_number ? <Link className="text-brand hover:underline" href="/accounting/journals">{refund.journal_entry_number}</Link> : "Not posted yet" },
                    { label: "Reversing entry", value: refund.reversal_entry_number ?? "—" },
                    { label: "Posting date", value: calendarDate(refund.accounting_date) },
                  ]} />
                </AccountingPanel>
              </div>
            </TabPanel>
          )}
          <TabPanel id="related">
            <div className="pt-4">
              <AccountingPanel title="Related documents" description="Where the credit came from. The invoice and the return did not pay money out themselves: the refund settles the credit they led to.">
                <Facts items={[
                  { label: source.typeLabel, value: sourceLink },
                  { label: "Invoice", value: detail.related.invoice ? (detail.related.invoice.fromSales ? <Link className="text-brand hover:underline" href={`/sales/invoices/${detail.related.invoice.id}`}>{detail.related.invoice.number}</Link> : detail.related.invoice.number) : "—" },
                  { label: "Sales return", value: detail.related.salesReturn ? <Link className="text-brand hover:underline" href={`/sales/returns/${detail.related.salesReturn.id}`}>{detail.related.salesReturn.number}</Link> : "—" },
                  { label: "Sales order", value: detail.related.salesOrder ? <Link className="text-brand hover:underline" href={`/sales/orders/${detail.related.salesOrder.id}`}>{detail.related.salesOrder.number}</Link> : "—" },
                ]} />
              </AccountingPanel>
            </div>
          </TabPanel>
          <TabPanel id="notes"><Notes detail={detail} canEdit={actions.edit || actions.post || actions.send} onChanged={refresh} /></TabPanel>
          <TabPanel id="history">
            <div className="pt-4">
              <AccountingPanel title="History">
                {!detail.events.length ? <p className="text-sm text-text-muted">No history yet.</p> : (
                  <ol className="flex flex-col divide-y divide-border text-sm">
                    {detail.events.map((event) => (
                      <li key={event.id} className="flex flex-col gap-0.5 py-2">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{EVENT_LABELS[event.event_type] ?? statusLabel(event.event_type.split(".").pop())}</span>
                          <span className="text-text-muted">{dateTime(event.occurred_at)}{event.actor_name ? ` · ${event.actor_name}` : ""}</span>
                        </span>
                        {eventDetail(event) && <span className="whitespace-pre-line text-text-secondary">{eventDetail(event)}</span>}
                      </li>
                    ))}
                  </ol>
                )}
              </AccountingPanel>
            </div>
          </TabPanel>
        </Tabs>
      </RecordDetailsPage>

      {dialog === "edit" && <EditRefundDialog detail={detail} onClose={() => setDialog(null)} onDone={() => done("The draft was saved.")} />}
      {dialog === "post" && <PostRefundDialog detail={detail} onClose={() => setDialog(null)} onDone={(message) => done(message)} />}
      {dialog === "cancel" && <CancelRefundDialog detail={detail} onClose={() => setDialog(null)} onDone={() => done("The draft was cancelled.")} />}
      {dialog === "reverse" && <ReverseRefundDialog detail={detail} onClose={() => setDialog(null)} onDone={(message) => done(message)} />}
      {dialog === "send" && <SendRefundDialog detail={detail} onClose={() => setDialog(null)} onDone={(sentTo) => done(`The confirmation was sent to ${sentTo}.`)} />}
      {dialog === "markSent" && <MarkRefundSentDialog detail={detail} onClose={() => setDialog(null)} onDone={() => done("The confirmation is marked as sent.")} />}
    </div>
  );
}

function Notes({ detail, canEdit, onChanged }: { detail: RefundDetail; canEdit: boolean; onChanged: () => void }) {
  const workspace = useWorkspaceContext();
  const refund = detail.refund;
  const filesKey = scopedQueryKey(workspace, "accounting", "customer-refund", refund.id, "files");
  const files = useQuery({ queryKey: filesKey, queryFn: () => listRefundFiles(refund.id).then((r) => r.files) });
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const after = () => { setError(null); void queryClient.invalidateQueries({ queryKey: filesKey }); onChanged(); };
  const upload = useMutation({ mutationFn: (file: File) => uploadRefundFile(refund.id, file), onSuccess: after, onError: (failure) => setError(failureText(failure, "The file could not be uploaded.")) });
  const remove = useMutation({ mutationFn: (fileId: string) => removeRefundFile(refund.id, fileId), onSuccess: after, onError: (failure) => setError(failureText(failure, "The file could not be removed.")) });
  return (
    <div className="flex flex-col gap-4 pt-4">
      <AccountingPanel title="Customer notes" description="Printed on the refund voucher."><p className="text-sm whitespace-pre-line">{refund.customer_notes ?? "None"}</p></AccountingPanel>
      <AccountingPanel title="Internal notes" description="Never printed or shown to the customer."><p className="text-sm whitespace-pre-line">{refund.internal_notes ?? "None"}</p></AccountingPanel>
      <AccountingPanel title="Attachments" description="The bank advice, the customer's request, and each voucher that was emailed."
        actions={canEdit ? (
          <>
            <input ref={input} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} />
            <Button variant="secondary" size="compact" isLoading={upload.isPending} onPress={() => input.current?.click()}><Upload className="size-4" aria-hidden="true" />Upload</Button>
          </>
        ) : undefined}>
        {error && <AccountingAlert>{error}</AccountingAlert>}
        {!files.data?.length ? <p className="text-sm text-text-muted">No files.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {files.data.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center gap-3 py-2">
                <a className="font-medium text-brand hover:underline" href={refundFileUrl(refund.id, file.id)}>{file.fileName}</a>
                <span className="text-text-muted">{dateTime(file.uploadedAt)}</span>
                {canEdit && <Button variant="ghost" size="compact" isLoading={remove.isPending} onPress={() => remove.mutate(file.id)}>Remove</Button>}
              </li>
            ))}
          </ul>
        )}
      </AccountingPanel>
    </div>
  );
}
