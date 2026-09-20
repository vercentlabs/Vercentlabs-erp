"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AuditTimeline, Button, ErrorState, PermissionState, RecordHeader, RelatedRecords, StatusBadge } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { getPosTransaction } from "@/features/pos/transactions/api/transactions-api";
import { dateTime, money } from "@/features/pos/shared/format";
import { PosBackLink, PosDataTable, PosLoading, PosPanel } from "@/features/pos/shared/PosUi";

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
        timestamp: dateTime(event.occurred_at),
      })),
    [query.data?.auditTrail],
  );

  if (query.isLoading) return <PosLoading label="Loading transaction…" />;

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
    <div className="flex flex-col gap-4">
      <PosBackLink href="/pos/transactions">All transactions</PosBackLink>
      <RecordHeader
        title={sale.receipt_number}
        status={<StatusBadge tone={statusTone[sale.status] ?? "neutral"}>{sale.status.replace("_", " ")}</StatusBadge>}
        fields={[
          { label: "Store", value: `${sale.store_name} (${sale.store_code})` },
          { label: "Terminal", value: sale.terminal_name },
          { label: "Cashier", value: sale.cashier_name ?? "—" },
          { label: "Shift", value: sale.shift_number },
          { label: "Date", value: dateTime(sale.completed_at ?? sale.sale_date) },
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

      <PosPanel title="Customer">
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
      </PosPanel>

      <PosPanel title="Line items">
        <PosDataTable
          caption="Line items"
          rows={lines}
          columns={[
            {
              key: "description",
              header: "Item",
              render: (line) => (
                <>
                  {line.description}
                  {line.item_code && <span className="ml-1 text-xs text-text-muted">({line.item_code})</span>}
                </>
              ),
            },
            { key: "quantity", header: "Qty", render: (line) => Number(line.quantity) },
            { key: "unit_price", header: "Unit price", render: (line) => money(currency, line.unit_price) },
            { key: "discount_amount", header: "Discount", render: (line) => (Number(line.discount_amount) > 0 ? money(currency, line.discount_amount) : "—") },
            { key: "tax_amount", header: "Tax", render: (line) => money(currency, line.tax_amount) },
            { key: "returned_quantity", header: "Returned", render: (line) => (Number(line.returned_quantity) > 0 ? Number(line.returned_quantity) : "—") },
            { key: "line_total", header: "Line total", numeric: true, render: (line) => money(currency, line.line_total) },
          ]}
        />
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
      </PosPanel>

      <PosPanel title="Payments">
        <PosDataTable
          caption="Payments"
          rows={payments}
          empty="No payment legs recorded."
          columns={[
            { key: "payment_method", header: "Method", render: (payment) => <span className="capitalize">{payment.payment_method.replace("_", " ")}</span> },
            { key: "amount", header: "Amount", render: (payment) => money(payment.currency_code ?? currency, payment.amount) },
            {
              key: "status",
              header: "Status",
              render: (payment) => <StatusBadge tone={payment.status === "captured" ? "success" : payment.status === "failed" ? "danger" : "warning"}>{payment.status}</StatusBadge>,
            },
            { key: "provider_reference", header: "Provider reference", render: (payment) => <span className="text-text-secondary">{payment.provider_reference ?? "—"}</span> },
            {
              key: "settlement_status",
              header: "Settlement",
              render: (payment) => (
                <span className="text-text-secondary">
                  {payment.settlement_status === "not_applicable" ? "—" : `${payment.settlement_status}${Number(payment.settled_amount) > 0 ? ` (${money(payment.currency_code ?? currency, payment.settled_amount)})` : ""}`}
                </span>
              ),
            },
          ]}
        />
      </PosPanel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PosPanel>
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
        </PosPanel>

        <PosPanel title="Accounting posting">
          <p className="mb-2 text-sm text-text-secondary">
            Status: <StatusBadge tone={accountingTone[sale.accounting_posting_status] ?? "neutral"}>{sale.accounting_posting_status.replace("_", " ")}</StatusBadge>
          </p>
          {sale.journal_entry_id && <p className="text-xs text-text-muted">Journal entry {sale.journal_entry_id}</p>}
          {sale.accounting_posted_at && <p className="text-xs text-text-muted">Posted {dateTime(sale.accounting_posted_at)}</p>}
          {sale.accounting_posting_error && <p className="text-xs text-danger">{sale.accounting_posting_error}</p>}
          <Link href="/pos/accounting" className="text-xs font-medium text-brand hover:underline">
            View accounting posting queue
          </Link>
        </PosPanel>
      </div>

      <PosPanel title="Stock movement">
        <PosDataTable
          caption="Stock movement"
          rows={stockMovements}
          empty="No stock movement is linked to this sale's lines."
          columns={[
            { key: "movement_number", header: "Movement #" },
            { key: "movement_type", header: "Type", render: (movement) => <span className="capitalize">{movement.movement_type}</span> },
            { key: "description", header: "Item" },
            { key: "quantity", header: "Quantity", render: (movement) => Number(movement.quantity) },
            { key: "unit_cost", header: "Unit cost", render: (movement) => money(currency, movement.unit_cost) },
            { key: "occurred_at", header: "Occurred", render: (movement) => <span className="text-text-secondary">{dateTime(movement.occurred_at)}</span> },
          ]}
        />
      </PosPanel>

      <PosPanel title="Audit trail">
        <AuditTimeline entries={auditEntries} emptyMessage="No recorded events for this sale yet." />
      </PosPanel>
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
