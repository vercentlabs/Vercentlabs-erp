"use client";

import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import {
  ErrorState,
  LinkButton,
  PageHeader,
  StatusBadge,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  getPosSaleReceipt,
  type PosReceiptLine,
  type PosReceiptPayment,
  type PosReceiptPromotionEvidence,
  type PosReceiptReturn,
} from "@/features/pos/receipts/api/receipts-api";
import { getPosSaleTaxes } from "@/features/pos/checkout/api/checkout-api";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime, money, statusLabel } from "@/features/pos/shared/format";
import { PosBackLink, PosLoading } from "@/features/pos/shared/PosUi";
import { ReceiptPrintActions } from "@/features/pos/receipts/components/ReceiptPrintActions";

// F289 -- a deterministic receipt built entirely from persisted sale facts
// (getPosSaleReceipt / tenant.pos_sales+pos_sale_lines+pos_payments+
// pos_returns). Printing (0096) prints the server-rendered snapshot of the finalized document through the browser's print dialog
// (ReceiptPrintActions): original first, then copies; it makes no claim about physical paper, which a browser cannot observe.
export function PosReceiptScreen({ saleId }: { saleId: string }) {
  const workspace = useWorkspaceContext();

  const receiptQueryKey = scopedQueryKey(workspace, "pos", "receipt", saleId);
  const query = useQuery({
    queryKey: receiptQueryKey,
    queryFn: () => getPosSaleReceipt(saleId),
  });
  // The sale's tax exactly as charged (its snapshot): the document title, seller and buyer GSTIN, place of supply, HSN/SAC and rates.
  const taxQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "sale-taxes", saleId), queryFn: () => getPosSaleTaxes(saleId) });
  const taxes = taxQuery.data;
  const taxLine = new Map((taxes?.lines ?? []).map((line) => [line.id, line]));
  if (query.isLoading) return <PosLoading label="Loading receipt…" />;
  if (query.isError || !query.data) {
    if (query.error instanceof PosApiError && query.error.status === 404) {
      return (
        <ErrorState
          title="Receipt not found"
          description="This receipt does not exist or you do not have access to its store."
        />
      );
    }
    return (
      <ErrorState
        title="Could not load this receipt"
        description={
          query.error instanceof PosApiError
            ? query.error.message
            : "Something went wrong."
        }
        action={{ label: "Retry", onPress: () => query.refetch() }}
      />
    );
  }

  const { sale, lines, payments, returns, promotionEvidence, printEvents } =
    query.data;
  const currency = sale.currency_code as string;
  const lastPrint = printEvents[0] ?? null;
  const isReprint = lastPrint?.print_type === "reprint";
  const printStatus = !lastPrint ? (
    <span title="Reflects a recorded print request, not confirmation from the physical printer — the browser has no way to observe that.">
      <StatusBadge tone="neutral">Not yet printed</StatusBadge>
    </span>
  ) : (
    <span title="Reflects a recorded print request, not confirmation from the physical printer — the browser has no way to observe that.">
      <StatusBadge tone={isReprint ? "warning" : "success"}>
        {isReprint
          ? `Copies sent to print (${printEvents.length}×)`
          : "Original sent to print"}
      </StatusBadge>
    </span>
  );

  return (
    <div className="flex flex-col gap-4 print:gap-0">
      <div className="flex flex-col gap-4 print:hidden">
        <PosBackLink href={`/pos/transactions/${saleId}`}>
          Back to transaction
        </PosBackLink>
        <PageHeader
          title={`Receipt ${sale.receipt_number}`}
          description={`${sale.store_name} · ${dateTime(sale.completed_at ?? sale.created_at)}`}
          secondaryActions={
            <div className="flex flex-wrap items-center gap-2">
              {printStatus}
              <LinkButton
                variant="secondary"
                href={`/api/documents/pos.receipt/${saleId}/pdf`}
                download
              >
                <Download className="size-4" aria-hidden="true" />
                Download PDF
              </LinkButton>
              <LinkButton variant="secondary" href={`/api/documents/pos.receipt/${saleId}/pdf?width=80`} download>80 mm</LinkButton>
              <LinkButton variant="secondary" href={`/api/documents/pos.receipt/${saleId}/pdf?width=58`} download>58 mm</LinkButton>
            </div>
          }
        />
        <ReceiptPrintActions source="pos_sale" sourceId={saleId} />
        {returns.filter((ret: PosReceiptReturn) => ret.status === "completed").map((ret: PosReceiptReturn) => (
          <div key={ret.id} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border p-3">
            <p className="text-sm font-medium">Return receipt {ret.return_number}</p>
            <ReceiptPrintActions source="pos_return" sourceId={ret.id} />
          </div>
        ))}
      </div>

      <div className="mx-auto flex w-full max-w-md flex-col gap-4 print:max-w-full">
        <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-6 font-mono text-sm shadow-[var(--shadow-subtle)] print:border-0 print:p-0 print:shadow-none">
          {isReprint && (
            <p className="text-center text-xs uppercase tracking-wide text-text-muted print:block">
              — Reprint —
            </p>
          )}
          {taxes?.documentType && (
            <p className="text-center text-xs font-semibold uppercase tracking-wide">{DOCUMENT_TITLE[taxes.documentType] ?? "Receipt"}</p>
          )}
          <div className="text-center">
            <p className="text-base font-semibold">{taxes?.seller?.legalName || sale.store_name}</p>
            {taxes?.seller?.legalName && <p className="text-text-secondary">{sale.store_name}</p>}
            <p className="text-text-secondary">{sale.terminal_name}</p>
            {taxes?.seller?.gstin && <p className="text-xs text-text-secondary">GSTIN {taxes.seller.gstin} · {taxes.seller.stateName} ({taxes.seller.stateCode})</p>}
          </div>
          <div className="flex justify-between text-xs text-text-secondary">
            <span>Receipt {sale.receipt_number}</span>
            <span>{dateTime(sale.completed_at ?? sale.created_at)}</span>
          </div>
          <div className="flex justify-between text-xs text-text-secondary">
            <span>Cashier: {sale.cashier_name ?? "—"}</span>
            <span>{sale.customer_display_name ?? "Walk-in"}</span>
          </div>
          {(taxes?.buyer?.gstin || taxes?.placeOfSupply) && (
            <div className="flex justify-between gap-2 text-xs text-text-secondary">
              <span>{taxes?.buyer?.gstin ? `Buyer GSTIN ${taxes.buyer.gstin}` : ""}</span>
              <span>{taxes?.placeOfSupply ? `Place of supply ${taxes.placeOfSupply}${taxes.supplyMode === "delivery" ? " (delivery)" : ""}` : ""}</span>
            </div>
          )}

          <div className="border-t border-dashed border-border" />

          <ul className="flex flex-col gap-1.5">
            {lines.map((line: PosReceiptLine) => (
              <li key={line.id} className="flex flex-col">
                <div className="flex justify-between">
                  <span>{line.description}</span>
                  <span className="tabular-nums">
                    {money(currency, line.line_total)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-text-muted">
                  <span>
                    {Number(line.quantity)} × {money(currency, line.unit_price)}
                    {taxLine.get(line.id) && <> · {lineTaxLabel(taxLine.get(line.id)!)}</>}
                  </span>
                  {Number(line.discount_amount) > 0 && (
                    <span>
                      {Number(line.manual_discount_amount) > 0 && line.manual_discount_type === "percent" && line.manual_discount_value
                        ? `Discount ${Number(line.manual_discount_value)}% ` : Number(line.manual_discount_amount) > 0 ? "Discount " : ""}
                      −{money(currency, line.discount_amount)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <div className="border-t border-dashed border-border" />

          <div className="flex flex-col gap-1">
            <Row label="Subtotal" value={money(currency, sale.subtotal)} />
            {Number(sale.discount_total) > 0 && (
              <Row
                label="Discounts"
                value={`−${money(currency, sale.discount_total)}`}
              />
            )}
            {Number(sale.cart_discount_amount ?? 0) > 0 && (
              <Row
                label={`Cart discount${sale.cart_discount_type === "percent" && sale.cart_discount_value ? ` (${Number(sale.cart_discount_value)}%)` : ""}`}
                value={`−${money(currency, sale.cart_discount_amount)}`}
                muted
              />
            )}
            {promotionEvidence.map(
              (application: PosReceiptPromotionEvidence) => (
                <Row
                  key={application.code}
                  label={`Promo ${application.code}`}
                  value={`−${money(currency, application.discount_amount)}`}
                  muted
                />
              ),
            )}
            {sale.coupon_code && (
              <Row label={`Coupon ${sale.coupon_code}`} value="" muted />
            )}
            {taxes?.taxableTotal != null && <Row label="Taxable value" value={money(currency, taxes.taxableTotal)} />}
            {taxes && taxes.breakdown.length > 0
              ? taxes.breakdown.map((entry) => (
                <Row key={`${entry.type}-${entry.rate}`} label={`${entry.label} ${Number(entry.rate)}%`} value={money(currency, entry.taxAmount)} />
              ))
              : <Row label="Tax" value={money(currency, sale.tax_total)} />}
            {Number(sale.rounding_adjustment) !== 0 && (
              <Row
                label="Rounding"
                value={money(currency, sale.rounding_adjustment)}
              />
            )}
            <div className="mt-1 flex justify-between border-t border-border pt-1 text-base font-semibold">
              <span>Total</span>
              <span className="tabular-nums">
                {money(currency, sale.grand_total)}
              </span>
            </div>
          </div>

          <div className="border-t border-dashed border-border" />

          <div className="flex flex-col gap-1">
            {payments.map((payment: PosReceiptPayment) => (
              <div key={payment.id} className="flex flex-col gap-1">
                {payment.payment_method === "cash" && payment.cash_received_amount ? (
                  <>
                    <Row label="Cash received" value={money(currency, payment.cash_received_amount)} />
                    {Number(payment.change_given_amount ?? 0) > 0 && <Row label="Change given" value={money(currency, payment.change_given_amount)} muted />}
                    <Row label="Cash applied" value={money(currency, payment.amount)} />
                  </>
                ) : (
                  <>
                    <Row label={`Paid (${payment.payment_method})`} value={money(currency, payment.amount)} />
                    {payment.payment_method !== "card" && payment.payment_method !== "cash" && (payment.provider_transaction_reference || payment.provider_reference) && (
                      <p className="text-xs text-text-muted">
                        {[payment.instrument && payment.instrument !== payment.payment_method ? payment.instrument.toUpperCase() : null,
                          payment.provider_transaction_reference ? `UTR ${payment.provider_transaction_reference}` : `Ref …${String(payment.provider_reference).slice(-8)}`,
                          payment.verification_status === "externally_attested" ? "Recorded against shop QR" : "Payment confirmed"].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    {payment.payment_method === "card" && (payment.card_last_four || payment.provider_reference || payment.external_reference) && (
                      <p className="text-xs text-text-muted">
                        {[payment.card_network, payment.card_last_four ? `**** ${payment.card_last_four}` : null,
                          payment.external_reference ? `Machine ref ${payment.external_reference}` : payment.provider_reference ? `Ref …${payment.provider_reference.slice(-8)}` : null,
                          payment.verification_status === "externally_attested" ? "Recorded from card machine" : null].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </>
                )}
              </div>
            ))}
            {!payments.some((payment: PosReceiptPayment) => payment.cash_received_amount) && <Row label="Change" value={money(currency, sale.change_total)} />}
          </div>

          {returns.length > 0 && (
            <>
              <div className="border-t border-dashed border-border" />
              <div className="flex flex-col gap-1 text-xs text-text-secondary">
                <p className="font-medium text-text">
                  Returns against this sale
                </p>
                {returns.map((ret: PosReceiptReturn) => (
                  <Row
                    key={ret.id}
                    label={`${ret.return_number} (${statusLabel(ret.status)})`}
                    value={`−${money(currency, ret.refund_total)}`}
                    muted
                  />
                ))}
              </div>
            </>
          )}

          <p className="pt-2 text-center text-xs text-text-muted">Thank you</p>
        </div>
      </div>
    </div>
  );
}

const DOCUMENT_TITLE: Record<string, string> = {
  tax_invoice: "Tax invoice", bill_of_supply: "Bill of supply", invoice_cum_bill_of_supply: "Tax invoice cum bill of supply",
};
const CLASS_LABEL: Record<string, string> = { nil_rated: "Nil-rated", exempt: "Exempt", non_gst: "Non-GST", zero_rated: "Zero-rated" };

// "HSN 8413 · GST 18%", or the treatment of a line that carries no GST.
function lineTaxLabel(line: { hsnSac: string | null; classification: string | null; rate: string | null }) {
  const code = line.hsnSac ? `HSN/SAC ${line.hsnSac}` : null;
  const gst = line.classification && line.classification !== "taxable" ? CLASS_LABEL[line.classification] ?? line.classification : line.rate != null ? `GST ${Number(line.rate)}%` : null;
  return [code, gst].filter(Boolean).join(" · ");
}

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex justify-between ${muted ? "text-xs text-text-muted" : ""}`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
