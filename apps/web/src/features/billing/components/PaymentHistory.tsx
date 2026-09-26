"use client";

import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@vercentlabs/design-system";

import type { Overview } from "../api/billing-api";
import { formatDate, inr, invoiceStatusLabel, methodLabel, paymentStatusLabel, seatChangeText } from "../billing-labels";
import { BillingPanel } from "./BillingPanel";

// Documents listed here are the payment provider's invoices/receipts. They are
// not Vercentlabs GST tax invoices.
export function PaymentHistory({ overview }: { overview: Overview }) {
  const included = overview.seats.includedUsers ?? 1;
  return (
    <>
      <BillingPanel title="Payments" testId="billing-payments">
        {overview.payments.length === 0 ? (
          <p className="text-sm text-text-muted">No payments yet.</p>
        ) : (
          <Table className="w-full text-sm">
            <TableHead>
              <TableRow className="border-b border-border text-left text-text-muted">
                <TableHeaderCell className="px-2 py-1 font-medium">Date</TableHeaderCell>
                <TableHeaderCell className="px-2 py-1 text-right font-medium">Amount</TableHeaderCell>
                <TableHeaderCell className="px-2 py-1 font-medium">Status</TableHeaderCell>
                <TableHeaderCell className="px-2 py-1 font-medium">Method</TableHeaderCell>
                <TableHeaderCell className="px-2 py-1 font-medium">Reference</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {overview.payments.map((payment) => (
                <TableRow key={payment.id} className="border-b border-border/50">
                  <TableCell className="px-2 py-1">{formatDate(payment.captured_at ?? payment.created_at)}</TableCell>
                  <TableCell className="px-2 py-1 text-right tabular-nums">
                    {inr(payment.amount_paise)}
                    {payment.amount_refunded_paise > 0 && <span className="block text-xs text-text-muted">{`${inr(payment.amount_refunded_paise)} refunded`}</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1">{paymentStatusLabel(payment.status, payment.refund_status)}</TableCell>
                  <TableCell className="px-2 py-1">{methodLabel(payment.method)}</TableCell>
                  <TableCell className="px-2 py-1 text-xs text-text-muted">{payment.provider_payment_id}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </BillingPanel>
      <BillingPanel title="Payment invoices and receipts" description="Issued by our payment provider, Razorpay, for each charge." testId="billing-invoices">
        {overview.invoices.length === 0 ? (
          <p className="text-sm text-text-muted">No payment invoices yet. They appear after your first charge.</p>
        ) : (
          <Table className="w-full text-sm">
            <TableHead>
              <TableRow className="border-b border-border text-left text-text-muted">
                <TableHeaderCell className="px-2 py-1 font-medium">Issued</TableHeaderCell>
                <TableHeaderCell className="px-2 py-1 text-right font-medium">Amount</TableHeaderCell>
                <TableHeaderCell className="px-2 py-1 font-medium">Status</TableHeaderCell>
                <TableHeaderCell className="px-2 py-1 font-medium">Document</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {overview.invoices.map((invoice) => (
                <TableRow key={invoice.id} className="border-b border-border/50">
                  <TableCell className="px-2 py-1">{formatDate(invoice.issued_at)}</TableCell>
                  <TableCell className="px-2 py-1 text-right tabular-nums">{inr(invoice.amount_paise)}</TableCell>
                  <TableCell className="px-2 py-1">{invoiceStatusLabel(invoice.status)}</TableCell>
                  <TableCell className="px-2 py-1">
                    {invoice.invoice_url ? (
                      <a className="text-brand hover:underline" href={invoice.invoice_url} target="_blank" rel="noreferrer noopener">
                        View provider invoice
                      </a>
                    ) : (
                      <span className="text-xs text-text-muted">{invoice.provider_invoice_id}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </BillingPanel>
      {overview.seatChanges.length > 0 && (
        <BillingPanel title="User changes" description="Every change to the number of paid users.">
          <ul className="text-sm">
            {overview.seatChanges.map((change) => (
              <li key={change.id} className="flex justify-between gap-3 border-b border-border/50 py-1">
                <span>{seatChangeText(change, included)}</span>
                <span className="text-text-muted">{formatDate(change.created_at)}</span>
              </li>
            ))}
          </ul>
        </BillingPanel>
      )}
    </>
  );
}
