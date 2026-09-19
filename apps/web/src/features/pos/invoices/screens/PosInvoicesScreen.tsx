"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, StatusBadge } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { listPosInvoices } from "@/features/pos/invoices/api/invoices-api";
import { money } from "@/features/pos/shared/format";

// F290 -- a read-only ledger of every generated POS tax invoice, each
// linking back to its source sale's receipt (the receipt screen is where
// generation and reprint both happen; this is the searchable list).
export function PosInvoicesScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "invoices"), queryFn: () => listPosInvoices({}) });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-text">Invoices</h1>
        <p className="text-sm text-text-secondary">Formal tax invoices generated for completed POS sales.</p>
      </div>

      <div className="rounded-[var(--radius-panel)] border border-border-strong bg-surface">
        {query.isLoading ? (
          <p className="p-4 text-sm text-text-secondary">Loading…</p>
        ) : query.isError ? (
          <ErrorState title="Could not load invoices" description="Something went wrong fetching the invoice list." action={{ label: "Retry", onPress: () => query.refetch() }} />
        ) : !query.data?.rows?.length ? (
          <p className="p-4 text-sm text-text-muted">No invoices have been generated yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {query.data.rows.map((row) => (
              <Link
                key={row.invoice_id}
                href={`/pos/receipts/${row.sale_id}`}
                className="flex items-center justify-between px-4 py-3 text-sm hover:bg-surface-muted"
              >
                <div>
                  <p className="font-medium text-text">{row.invoice_number}</p>
                  <p className="text-xs text-text-muted">
                    {row.customer_name ?? "—"} · Receipt {row.receipt_number} · {new Date(row.invoice_generated_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">{money(row.currency_code, row.grand_total)}</span>
                  <StatusBadge tone={row.invoice_status === "posted" ? "success" : "neutral"}>{row.invoice_status}</StatusBadge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
