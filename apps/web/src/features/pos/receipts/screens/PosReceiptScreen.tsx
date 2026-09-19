"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { Button } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  getPosSaleReceipt,
  recordPosReceiptPrint,
  type PosReceiptLine,
  type PosReceiptPayment,
  type PosReceiptPromotionEvidence,
  type PosReceiptReturn,
} from "@/features/pos/receipts/api/receipts-api";
import { getPosSaleInvoice, generatePosSaleInvoice } from "@/features/pos/invoices/api/invoices-api";
import { PosApiError } from "@/features/pos/shared/http";
import { money } from "@/features/pos/shared/format";

// F289 -- a deterministic receipt built entirely from persisted sale facts
// (getPosSaleReceipt / tenant.pos_sales+pos_sale_lines+pos_payments+
// pos_returns). Printing uses the browser's own print dialog
// (window.print()); this screen only proves the RECEIPT DOCUMENT is
// correct and reproducible from stored data -- it makes no claim about
// physical printer hardware, which browser printing cannot observe.
export function PosReceiptScreen({ saleId }: { saleId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canGenerateInvoice = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.invoiceGenerate);

  const receiptQueryKey = scopedQueryKey(workspace, "pos", "receipt", saleId);
  const query = useQuery({ queryKey: receiptQueryKey, queryFn: () => getPosSaleReceipt(saleId) });
  // F289 gap closure: Original/Reprint is now derived from the server's own
  // durable print-attempt log (tenant.pos_receipt_print_events), never from
  // a client-supplied `?original=1` URL parameter — that was trivially
  // forgeable and proved nothing about real print history.
  const recordPrint = useMutation({
    mutationFn: () => recordPosReceiptPrint(saleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: receiptQueryKey }),
  });
  function handlePrint() {
    recordPrint.mutate(undefined, { onSuccess: () => window.print() });
  }
  // F290: a 404 here just means no invoice has been generated for this
  // sale yet -- not an error state, so retries are disabled and the
  // "not found" case renders the Generate button instead of an ErrorState.
  const invoiceQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "invoice", saleId),
    queryFn: () => getPosSaleInvoice(saleId),
    retry: false,
  });
  const generateInvoice = useMutation({
    mutationFn: () => generatePosSaleInvoice(saleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "invoice", saleId) }),
  });

  if (query.isLoading) return <p className="p-8 text-center text-sm text-text-secondary">Loading receipt…</p>;
  if (query.isError || !query.data) return <p className="p-8 text-center text-sm text-danger">This receipt could not be found.</p>;

  const { sale, lines, payments, returns, promotionEvidence, printEvents } = query.data;
  const currency = sale.currency_code as string;
  const timestamp = new Date(sale.completed_at ?? sale.created_at);
  const hasCustomer = Boolean(sale.customer_display_name);
  const invoiceNotFound = invoiceQuery.isError && invoiceQuery.error instanceof PosApiError && invoiceQuery.error.status === 404;
  const lastPrint = printEvents[0] ?? null;
  const isReprint = lastPrint?.print_type === "reprint";

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-4 print:max-w-full">
      <div className="flex items-center justify-between print:hidden">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            !lastPrint ? "bg-surface-muted text-text-secondary" : isReprint ? "bg-warning-soft text-warning" : "bg-success-soft text-success"
          }`}
        >
          {!lastPrint ? "Not yet printed" : isReprint ? `Reprinted (${printEvents.length}×)` : "Printed — original"}
        </span>
        <Button variant="secondary" size="compact" onPress={handlePrint} isLoading={recordPrint.isPending}>
          <Printer className="size-4" aria-hidden="true" />
          Print
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border-strong bg-surface p-6 font-mono text-sm print:border-0 print:p-0">
        {isReprint && <p className="text-center text-xs uppercase tracking-wide text-text-muted print:block">— Reprint —</p>}
        <div className="text-center">
          <p className="text-base font-semibold">{sale.store_name}</p>
          <p className="text-text-secondary">{sale.terminal_name}</p>
        </div>
        <div className="flex justify-between text-xs text-text-secondary">
          <span>Receipt {sale.receipt_number}</span>
          <span>{timestamp.toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-xs text-text-secondary">
          <span>Cashier: {sale.cashier_name ?? "—"}</span>
          <span>{sale.customer_display_name ?? "Walk-in"}</span>
        </div>

        <div className="border-t border-dashed border-border" />

        <ul className="flex flex-col gap-1.5">
          {lines.map((line: PosReceiptLine) => (
            <li key={line.id} className="flex flex-col">
              <div className="flex justify-between">
                <span>{line.description}</span>
                <span className="tabular-nums">{money(currency, line.line_total)}</span>
              </div>
              <div className="flex justify-between text-xs text-text-muted">
                <span>
                  {Number(line.quantity)} × {money(currency, line.unit_price)}
                </span>
                {Number(line.discount_amount) > 0 && <span>−{money(currency, line.discount_amount)}</span>}
              </div>
            </li>
          ))}
        </ul>

        <div className="border-t border-dashed border-border" />

        <div className="flex flex-col gap-1">
          <Row label="Subtotal" value={money(currency, sale.subtotal)} />
          {Number(sale.discount_total) > 0 && <Row label="Discounts" value={`−${money(currency, sale.discount_total)}`} />}
          {promotionEvidence.map((application: PosReceiptPromotionEvidence) => (
            <Row key={application.code} label={`Promo ${application.code}`} value={`−${money(currency, application.discount_amount)}`} muted />
          ))}
          {sale.coupon_code && <Row label={`Coupon ${sale.coupon_code}`} value="" muted />}
          <Row label="Tax" value={money(currency, sale.tax_total)} />
          {Number(sale.rounding_adjustment) !== 0 && <Row label="Rounding" value={money(currency, sale.rounding_adjustment)} />}
          <div className="mt-1 flex justify-between border-t border-border pt-1 text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{money(currency, sale.grand_total)}</span>
          </div>
        </div>

        <div className="border-t border-dashed border-border" />

        <div className="flex flex-col gap-1">
          {payments.map((payment: PosReceiptPayment) => (
            <Row key={payment.id} label={`Paid (${payment.payment_method})`} value={money(currency, payment.amount)} />
          ))}
          <Row label="Change" value={money(currency, sale.change_total)} />
        </div>

        {returns.length > 0 && (
          <>
            <div className="border-t border-dashed border-border" />
            <div className="flex flex-col gap-1 text-xs text-text-secondary">
              <p className="font-medium text-text">Returns against this sale</p>
              {returns.map((ret: PosReceiptReturn) => (
                <Row key={ret.id} label={`${ret.return_number} (${ret.status})`} value={`−${money(currency, ret.refund_total)}`} muted />
              ))}
            </div>
          </>
        )}

        <p className="pt-2 text-center text-xs text-text-muted">Thank you</p>
      </div>

      {canGenerateInvoice && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-border-strong bg-surface p-4 text-sm print:hidden">
          {invoiceQuery.data ? (
            <div className="flex items-center justify-between">
              <span>
                Invoice <span className="font-medium text-text">{invoiceQuery.data.invoice.invoice_number}</span> ({invoiceQuery.data.invoice.status})
              </span>
              <span className="tabular-nums">{money(invoiceQuery.data.invoice.currency_code, invoiceQuery.data.invoice.grand_total)}</span>
            </div>
          ) : invoiceNotFound ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-text-secondary">{hasCustomer ? "No tax invoice generated yet." : "Attach a customer to this sale to generate a tax invoice."}</span>
              <Button variant="secondary" size="compact" onPress={() => generateInvoice.mutate()} isDisabled={!hasCustomer} isLoading={generateInvoice.isPending}>
                Generate invoice
              </Button>
            </div>
          ) : null}
          {generateInvoice.isError && (
            <p className="text-xs text-danger">{generateInvoice.error instanceof PosApiError ? generateInvoice.error.message : "The invoice could not be generated."}</p>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-xs text-text-muted" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
