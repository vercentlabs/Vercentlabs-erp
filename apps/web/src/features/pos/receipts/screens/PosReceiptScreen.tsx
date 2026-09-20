"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import Link from "next/link";
import { Button, ErrorState, PageHeader, StatusBadge } from "@vercentlabs/design-system";
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
import { dateTime, money, statusLabel, statusTone } from "@/features/pos/shared/format";
import { PosAlert, PosBackLink, PosLoading, PosPanel } from "@/features/pos/shared/PosUi";

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

  if (query.isLoading) return <PosLoading label="Loading receipt…" />;
  if (query.isError || !query.data) {
    if (query.error instanceof PosApiError && query.error.status === 404) {
      return <ErrorState title="Receipt not found" description="This receipt does not exist or you do not have access to its store." />;
    }
    return (
      <ErrorState
        title="Could not load this receipt"
        description={query.error instanceof PosApiError ? query.error.message : "Something went wrong."}
        action={{ label: "Retry", onPress: () => query.refetch() }}
      />
    );
  }

  const { sale, lines, payments, returns, promotionEvidence, printEvents } = query.data;
  const currency = sale.currency_code as string;
  const hasCustomer = Boolean(sale.customer_display_name);
  const invoiceNotFound = invoiceQuery.isError && invoiceQuery.error instanceof PosApiError && invoiceQuery.error.status === 404;
  const lastPrint = printEvents[0] ?? null;
  const isReprint = lastPrint?.print_type === "reprint";
  // F289 browser-side recovery: a failed print-attempt record (network
  // blip, permission change, server error) previously failed silently --
  // onSuccess fired window.print() but nothing ever reported a failure, so
  // a cashier had no way to know the click didn't work. The Print button
  // itself IS the retry action (react-query's mutate can simply be
  // re-invoked); this banner makes the failure and the retry path visible
  // instead of a silent no-op.
  const printError = recordPrint.isError ? (recordPrint.error instanceof PosApiError ? recordPrint.error.message : "The print attempt could not be recorded.") : null;

  const printStatus = !lastPrint ? (
    <span title="Reflects a recorded print request, not confirmation from the physical printer — the browser has no way to observe that.">
      <StatusBadge tone="neutral">Not yet printed</StatusBadge>
    </span>
  ) : (
    <span title="Reflects a recorded print request, not confirmation from the physical printer — the browser has no way to observe that.">
      <StatusBadge tone={isReprint ? "warning" : "success"}>{isReprint ? `Reprint attempted (${printEvents.length}×)` : "Print attempted — original"}</StatusBadge>
    </span>
  );

  return (
    <div className="flex flex-col gap-4 print:gap-0">
      <div className="flex flex-col gap-4 print:hidden">
        <PosBackLink href={`/pos/transactions/${saleId}`}>Back to transaction</PosBackLink>
        <PageHeader
          title={`Receipt ${sale.receipt_number}`}
          description={`${sale.store_name} · ${dateTime(sale.completed_at ?? sale.created_at)}`}
          secondaryActions={printStatus}
          primaryAction={
            <Button variant="primary" onPress={handlePrint} isLoading={recordPrint.isPending}>
              <Printer className="size-4" aria-hidden="true" />
              {printError ? "Retry print" : "Print"}
            </Button>
          }
        />
        {printError && <PosAlert>{printError} — click Retry print to try again.</PosAlert>}
      </div>

      <div className="mx-auto flex w-full max-w-md flex-col gap-4 print:max-w-full">
      <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-6 font-mono text-sm shadow-[var(--shadow-subtle)] print:border-0 print:p-0 print:shadow-none">
        {isReprint && <p className="text-center text-xs uppercase tracking-wide text-text-muted print:block">— Reprint —</p>}
        <div className="text-center">
          <p className="text-base font-semibold">{sale.store_name}</p>
          <p className="text-text-secondary">{sale.terminal_name}</p>
        </div>
        <div className="flex justify-between text-xs text-text-secondary">
          <span>Receipt {sale.receipt_number}</span>
          <span>{dateTime(sale.completed_at ?? sale.created_at)}</span>
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
                <Row key={ret.id} label={`${ret.return_number} (${statusLabel(ret.status)})`} value={`−${money(currency, ret.refund_total)}`} muted />
              ))}
            </div>
          </>
        )}

        <p className="pt-2 text-center text-xs text-text-muted">Thank you</p>
      </div>

      {canGenerateInvoice && (
        <PosPanel
          title="Tax invoice"
          className="print:hidden"
          actions={
            <Link href="/pos/invoices" className="text-xs font-medium text-brand hover:underline">
              All invoices
            </Link>
          }
        >
          {invoiceQuery.data ? (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <span className="font-medium text-text">{invoiceQuery.data.invoice.invoice_number}</span>
                <StatusBadge tone={statusTone(invoiceQuery.data.invoice.status)}>{statusLabel(invoiceQuery.data.invoice.status)}</StatusBadge>
              </span>
              <span className="tabular-nums">{money(invoiceQuery.data.invoice.currency_code, invoiceQuery.data.invoice.grand_total)}</span>
            </div>
          ) : invoiceNotFound ? (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-text-secondary">{hasCustomer ? "No tax invoice generated yet." : "Attach a customer to this sale to generate a tax invoice."}</span>
              <Button variant="secondary" size="compact" onPress={() => generateInvoice.mutate()} isDisabled={!hasCustomer} isLoading={generateInvoice.isPending}>
                Generate invoice
              </Button>
            </div>
          ) : (
            <p className="text-sm text-text-muted">Checking for an invoice…</p>
          )}
          {generateInvoice.isError && (
            <PosAlert>{generateInvoice.error instanceof PosApiError ? generateInvoice.error.message : "The invoice could not be generated."}</PosAlert>
          )}
        </PosPanel>
      )}
      </div>
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
