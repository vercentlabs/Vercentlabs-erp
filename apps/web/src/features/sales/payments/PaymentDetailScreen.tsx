"use client";

// One payment received (Sales plan): who paid, how much, how (with the cheque or UTR), the bills it settled and what is kept as an
// advance; its receipt as a PDF and on WhatsApp.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { ErrorState, PermissionState, RecordDetailsPage, StatusBadge, buttonVariants } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { Cell, LinesTable } from "@/shared/ui/record";
import { Facts, Notice, Panel } from "@/shared/ui/Panel";
import { SalesApiError } from "@/features/sales/shared/http";
import { calendarDate, money } from "@/features/sales/shared/format";
import { WhatsAppSendButton } from "@/features/sales/shared/WhatsAppSend";

import { getPayment, receiptPdfUrl } from "./api";

export function PaymentDetailScreen({ paymentId }: { paymentId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "payment", paymentId), queryFn: () => getPayment(paymentId) });
  if (query.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>;
  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to payments" description="Ask an administrator for the View invoice payments permission." />;
  if (query.isError || !query.data)
    return <ErrorState title={query.error instanceof SalesApiError && query.error.status === 404 ? "Payment not found" : "Could not load this payment"} action={{ label: "Retry", onPress: () => void query.refetch() }} />;
  const { payment, allocations } = query.data;
  const currency = payment.currencyCode;
  const how = [payment.methodLabel, payment.chequeNumber && `No. ${payment.chequeNumber}`, payment.chequeDate && `dated ${calendarDate(payment.chequeDate)}`, payment.draweeBank].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-4">
      {payment.reversedAt && <Notice tone="warning">This payment was reversed{payment.reversalReason ? `: ${payment.reversalReason}` : ""}. The bills it paid are owed again.</Notice>}
      <RecordDetailsPage
        header={{
          title: payment.number,
          status: <StatusBadge tone={payment.reversedAt ? "danger" : "success"}>{payment.reversedAt ? "Reversed" : "Received"}</StatusBadge>,
          fields: [
            { label: "Customer", value: <Link className="hover:underline" href={`/sales/customers/${payment.customer.id}`}>{payment.customer.name}</Link> },
            { label: "Received on", value: calendarDate(payment.date) },
            { label: "Amount", value: money(currency, payment.amount) },
            { label: "Paid by", value: how || "—" },
            ...(payment.unapplied > 0.005 ? [{ label: "Advance", value: money(currency, payment.unapplied) }] : []),
          ],
          secondaryActions: (
            <div className="flex flex-wrap items-center gap-2">
              <a className={buttonVariants({ variant: "secondary" })} href={receiptPdfUrl(payment.id, true)} target="_blank" rel="noreferrer"><Eye className="size-4" aria-hidden="true" />Receipt PDF</a>
              <WhatsAppSendButton kind="receipt" id={payment.id} pdfUrl={receiptPdfUrl(payment.id)} />
            </div>
          ),
        }}
      >
        <Panel title="Bills settled" description={payment.unapplied > 0.005 ? `${money(currency, payment.unapplied)} is not applied yet: it is offered on the customer's next invoice.` : undefined}>
          <LinesTable columns={["Bill", "Bill date", { label: "Bill total", numeric: true }, { label: "TDS", numeric: true }, { label: "Settled", numeric: true }]}
            empty={allocations.length ? undefined : "Kept as an advance: no bill settled yet."}>
            {allocations.map((row) => (
              <tr key={`${row.invoiceId}-${row.amount}`}>
                <Cell><Link className="text-brand hover:underline" href={`/sales/invoices/${row.invoiceId}?tab=payments`}>{row.invoiceNumber}</Link></Cell>
                <Cell>{calendarDate(row.invoiceDate)}</Cell>
                <Cell numeric>{money(currency, row.invoiceTotal)}</Cell>
                <Cell numeric>{row.tds ? `${money(currency, row.tds)}${row.tdsSection ? ` (${row.tdsSection})` : ""}` : "—"}</Cell>
                <Cell numeric>{money(currency, row.amount)}</Cell>
              </tr>
            ))}
          </LinesTable>
        </Panel>
        <Panel title="Details">
          <Facts items={[
            { label: "Reference / UTR", value: payment.reference ?? "—" },
            { label: "Into", value: payment.bankAccount ?? "The company's bank account" },
            { label: "Customer GSTIN", value: payment.customer.gstin ?? "—" },
            { label: "Note", value: payment.notes ?? "—" },
          ]} />
        </Panel>
      </RecordDetailsPage>
    </div>
  );
}
