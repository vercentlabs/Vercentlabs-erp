"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { Button } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  getPosSaleReceipt,
  type PosReceiptLine,
  type PosReceiptPayment,
  type PosReceiptPromotionEvidence,
  type PosReceiptReturn,
} from "@/features/pos/receipts/api/receipts-api";
import { money } from "@/features/pos/shared/format";

// F289 -- a deterministic receipt built entirely from persisted sale facts
// (getPosSaleReceipt / tenant.pos_sales+pos_sale_lines+pos_payments+
// pos_returns). Printing uses the browser's own print dialog
// (window.print()); this screen only proves the RECEIPT DOCUMENT is
// correct and reproducible from stored data -- it makes no claim about
// physical printer hardware, which browser printing cannot observe.
export function PosReceiptScreen({ saleId }: { saleId: string }) {
  const workspace = useWorkspaceContext();
  const searchParams = useSearchParams();
  const isOriginal = searchParams.get("original") === "1";

  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "receipt", saleId), queryFn: () => getPosSaleReceipt(saleId) });

  if (query.isLoading) return <p className="p-8 text-center text-sm text-text-secondary">Loading receipt…</p>;
  if (query.isError || !query.data) return <p className="p-8 text-center text-sm text-danger">This receipt could not be found.</p>;

  const { sale, lines, payments, returns, promotionEvidence } = query.data;
  const currency = sale.currency_code as string;
  const timestamp = new Date(sale.completed_at ?? sale.created_at);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-4 print:max-w-full">
      <div className="flex items-center justify-between print:hidden">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${isOriginal ? "bg-success-soft text-success" : "bg-surface-muted text-text-secondary"}`}>
          {isOriginal ? "Original" : "Reprint"}
        </span>
        <Button variant="secondary" size="compact" onPress={() => window.print()}>
          <Printer className="size-4" aria-hidden="true" />
          Print
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border-strong bg-surface p-6 font-mono text-sm print:border-0 print:p-0">
        {!isOriginal && <p className="text-center text-xs uppercase tracking-wide text-text-muted print:block">— Reprint —</p>}
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
