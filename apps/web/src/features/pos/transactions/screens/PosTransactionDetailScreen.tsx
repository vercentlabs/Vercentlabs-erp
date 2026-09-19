"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AuditTimeline, Button, ErrorState, PermissionState, RecordHeader, RelatedRecords, StatusBadge } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { getPosTransaction } from "@/features/pos/transactions/api/transactions-api";
import { money } from "@/features/pos/shared/format";

const statusTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  completed: "success",
  partially_returned: "warning",
  returned: "warning",
  voided: "danger",
};

const accountingTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  pending: "warning",
  posted: "success",
  failed: "danger",
  not_applicable: "neutral",
};

const returnStatusTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  pending_approval: "warning",
  approved: "info",
  completed: "success",
  rejected: "danger",
  cancelled: "neutral",
};

// F268-F307 completion gap closure -- the transaction detail drill-down.
// Every value on this page is read straight from getPosTransactionDetail
// (a read of already-persisted tenant.pos_sales/pos_sale_lines/
// pos_payments/pos_returns/stock_movements/pos_events rows); nothing here
// recomputes a total, a tax figure or a status. Receipt rendering,
// invoicing, return workflow and accounting posting each already have
// their own dedicated screens -- this links into them rather than
// rebuilding any of them.
export function PosTransactionDetailScreen({ saleId }: { saleId: string }) {
  const router = useRouter();
  const workspace = useWorkspaceContext();

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "transaction", saleId),
    queryFn: () => getPosTransaction(saleId),
    retry: (failureCount, error) => !(error instanceof PosApiError && (error.status === 403 || error.status === 404)) && failureCount < 2,
  });

  const auditEntries = useMemo(
    () =>
      (query.data?.auditTrail ?? []).map((event) => ({
        id: event.id,
        title: `${event.actor_name ?? "System"} — ${event.event_type.replace(/^pos\./, "").replace(/[._]/g, " ")}`,
        timestamp: new Date(event.occurred_at).toLocaleString(),
      })),
    [query.data?.auditTrail],
  );

  if (query.isLoading) return <p className="p-6 text-sm text-text-secondary">Loading transaction…</p>;

  if (query.isError) {
    if (query.error instanceof PosApiError && query.error.status === 403) {
      return <PermissionState title="You don't have access to this transaction" description="This sale belongs to a store you are not assigned to." />;
    }
    if (query.error instanceof PosApiError && query.error.status === 404) {
      return <ErrorState title="Transaction not found" action={{ label: "Back to transactions", onPress: () => router.push("/pos/transactions") }} />;
    }
    return (
      <ErrorState
        title="Could not load this transaction"
        description={query.error instanceof PosApiError ? query.error.message : "Something went wrong."}
        action={{ label: "Retry", onPress: () => query.refetch() }}
      />
    );
  }
  if (!query.data) return null;

  const { sale, lines, payments, returns, promotionEvidence, stockMovements } = query.data;
  const currency = sale.currency_code;

  return (
    <div className="flex flex-col gap-6">
      <RecordHeader
        breadcrumbs={
          <button type="button" className="text-sm text-text-secondary hover:underline" onClick={() => router.push("/pos/transactions")}>
            ← All transactions
          </button>
        }
        title={sale.receipt_number}
        status={<StatusBadge tone={statusTone[sale.status] ?? "neutral"}>{sale.status.replace("_", " ")}</StatusBadge>}
        fields={[
          { label: "Store", value: `${sale.store_name} (${sale.store_code})` },
          { label: "Terminal", value: sale.terminal_name },
          { label: "Cashier", value: sale.cashier_name ?? "—" },
          { label: "Shift", value: sale.shift_number },
          { label: "Date", value: new Date(sale.completed_at ?? sale.sale_date).toLocaleString() },
          { label: "Total", value: money(currency, sale.grand_total) },
        ]}
        primaryAction={
          <Button variant="secondary" onPress={() => router.push(`/pos/receipts/${sale.id}`)}>
            View receipt
          </Button>
        }
        secondaryActions={
          sale.accounting_invoice_id ? (
            <Button variant="secondary" onPress={() => router.push("/pos/invoices")}>
              View invoice
            </Button>
          ) : undefined
        }
      />

      <section className="rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-text">Customer</h2>
        {sale.customer_id ? (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-text-muted">Name</dt>
              <dd className="text-sm font-medium text-text">{sale.customer_display_name ?? sale.customer_name}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">Phone</dt>
              <dd className="text-sm text-text">{sale.customer_phone ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">Email</dt>
              <dd className="text-sm text-text">{sale.customer_email ?? "—"}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-text-secondary">Walk-in customer — no party attached to this sale.</p>
        )}
      </section>

      <section className="rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-text">Line items</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-text-muted">
              <th className="pb-2">Item</th>
              <th className="pb-2">Qty</th>
              <th className="pb-2">Unit price</th>
              <th className="pb-2">Discount</th>
              <th className="pb-2">Tax</th>
              <th className="pb-2">Returned</th>
              <th className="pb-2 text-right">Line total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-t border-border">
                <td className="py-2">
                  {line.description}
                  {line.item_code && <span className="ml-1 text-xs text-text-muted">({line.item_code})</span>}
                </td>
                <td className="py-2">{Number(line.quantity)}</td>
                <td className="py-2">{money(currency, line.unit_price)}</td>
                <td className="py-2">{Number(line.discount_amount) > 0 ? money(currency, line.discount_amount) : "—"}</td>
                <td className="py-2">{money(currency, line.tax_amount)}</td>
                <td className="py-2">{Number(line.returned_quantity) > 0 ? Number(line.returned_quantity) : "—"}</td>
                <td className="py-2 text-right tabular-nums">{money(currency, line.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {promotionEvidence.length > 0 && (
          <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-xs text-text-secondary">
            <p className="font-medium text-text">Promotions applied</p>
            {promotionEvidence.map((application) => (
              <p key={application.code}>
                {application.code} — {application.name}: −{money(currency, application.discount_amount)}
              </p>
            ))}
            {sale.coupon_code && <p>Coupon: {sale.coupon_code}</p>}
          </div>
        )}
        <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3 sm:ml-auto sm:w-64">
          <TotalsRow label="Subtotal" value={money(currency, sale.subtotal)} />
          <TotalsRow label="Discount" value={`−${money(currency, sale.discount_total)}`} />
          <TotalsRow label="Tax" value={money(currency, sale.tax_total)} />
          {Number(sale.rounding_adjustment) !== 0 && <TotalsRow label="Rounding" value={money(currency, sale.rounding_adjustment)} />}
          <TotalsRow label="Grand total" value={money(currency, sale.grand_total)} emphasize />
          <TotalsRow label="Paid" value={money(currency, sale.paid_total)} />
          <TotalsRow label="Change" value={money(currency, sale.change_total)} />
        </div>
      </section>

      <section className="rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-text">Payments</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-text-secondary">No payment legs recorded.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted">
                <th className="pb-2">Method</th>
                <th className="pb-2">Amount</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Provider reference</th>
                <th className="pb-2">Settlement</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-t border-border">
                  <td className="py-2 capitalize">{payment.payment_method.replace("_", " ")}</td>
                  <td className="py-2">{money(payment.currency_code ?? currency, payment.amount)}</td>
                  <td className="py-2">
                    <StatusBadge tone={payment.status === "captured" ? "success" : payment.status === "failed" ? "danger" : "warning"}>{payment.status}</StatusBadge>
                  </td>
                  <td className="py-2 text-text-secondary">{payment.provider_reference ?? "—"}</td>
                  <td className="py-2 text-text-secondary">
                    {payment.settlement_status === "not_applicable" ? "—" : `${payment.settlement_status}${Number(payment.settled_amount) > 0 ? ` (${money(payment.currency_code ?? currency, payment.settled_amount)})` : ""}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
          <RelatedRecords
            title="Returns / refunds"
            emptyMessage="No returns have been filed against this sale."
            records={returns.map((r) => ({
              id: r.id,
              href: "/pos/returns",
              title: r.return_number,
              meta: (
                <span className="flex items-center gap-2">
                  <StatusBadge tone={returnStatusTone[r.status] ?? "neutral"}>{r.status.replace("_", " ")}</StatusBadge>
                  {money(currency, r.refund_total)}
                </span>
              ),
            }))}
          />
        </section>

        <section className="rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-text">Accounting posting</h2>
          <p className="mb-2 text-sm text-text-secondary">
            Status: <StatusBadge tone={accountingTone[sale.accounting_posting_status] ?? "neutral"}>{sale.accounting_posting_status.replace("_", " ")}</StatusBadge>
          </p>
          {sale.journal_entry_id && <p className="text-xs text-text-muted">Journal entry {sale.journal_entry_id}</p>}
          {sale.accounting_posted_at && <p className="text-xs text-text-muted">Posted {new Date(sale.accounting_posted_at).toLocaleString()}</p>}
          {sale.accounting_posting_error && <p className="text-xs text-danger">{sale.accounting_posting_error}</p>}
          <a href="/pos/accounting" className="mt-2 inline-block text-xs font-medium text-brand underline">
            View accounting posting queue
          </a>
        </section>
      </div>

      <section className="rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-text">Stock movement</h2>
        {stockMovements.length === 0 ? (
          <p className="text-sm text-text-secondary">No stock movement is linked to this sale&apos;s lines.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted">
                <th className="pb-2">Movement #</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Item</th>
                <th className="pb-2">Quantity</th>
                <th className="pb-2">Unit cost</th>
                <th className="pb-2">Occurred</th>
              </tr>
            </thead>
            <tbody>
              {stockMovements.map((movement) => (
                <tr key={movement.id} className="border-t border-border">
                  <td className="py-2">{movement.movement_number}</td>
                  <td className="py-2 capitalize">{movement.movement_type}</td>
                  <td className="py-2">{movement.description}</td>
                  <td className="py-2">{Number(movement.quantity)}</td>
                  <td className="py-2">{money(currency, movement.unit_cost)}</td>
                  <td className="py-2 text-text-secondary">{new Date(movement.occurred_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-text">Audit trail</h2>
        <AuditTimeline entries={auditEntries} emptyMessage="No recorded events for this sale yet." />
      </section>
    </div>
  );
}

function TotalsRow({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className={`flex justify-between ${emphasize ? "border-t border-border pt-1 text-sm font-semibold text-text" : "text-sm text-text-secondary"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
