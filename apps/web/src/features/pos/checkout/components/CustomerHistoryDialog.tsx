"use client";

// A named customer's POS purchases at the outlets this cashier works at, newest first, from finished sales only: receipt, date, outlet,
// total, how it was paid, what has been returned. Read-only; a receipt opens the sale, where a return is started against it.
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, Dialog, StatusBadge } from "@vercentlabs/design-system";

import { money } from "@/features/pos/shared/format";
import { PosApiError } from "@/features/pos/shared/http";
import { formatDateTime } from "@/shared/format/human";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getPosCustomerPurchases, type PosCustomerPurchase } from "../api/checkout-api";

const STATUS: Record<string, [string, "success" | "warning" | "neutral"]> = {
  completed: ["Completed", "success"], partially_returned: ["Partly returned", "warning"], returned: ["Returned", "neutral"],
};
const METHOD: Record<string, string> = { cash: "Cash", card: "Card", upi: "UPI", wallet: "Wallet", bank_transfer: "Bank transfer" };

export function CustomerHistoryDialog({ customerId, customerName, cartId, onClose }: { customerId: string; customerName: string; cartId: string; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const [pages, setPages] = useState(1);
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "customer-purchases", customerId, pages),
    queryFn: async () => {
      const rows: PosCustomerPurchase[] = [];
      let total = 0;
      for (let page = 0; page < pages; page += 1) {
        const response = await getPosCustomerPurchases(customerId, cartId, page * 10);
        rows.push(...response.rows);
        total = response.total;
      }
      return { rows, total };
    },
  });
  const rows = query.data?.rows ?? [];
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Purchases — ${customerName}`} size="lg"
      description="Finished sales at your outlets. Open a receipt to reprint it or start a return.">
      {query.isLoading ? <p className="text-sm text-text-muted">Loading purchases…</p>
        : query.isError ? <p className="text-sm text-danger">{query.error instanceof PosApiError ? query.error.message : "The purchases could not be loaded."}</p>
          : rows.length === 0 ? <p className="text-sm text-text-muted">No purchases at your outlets yet.</p> : (
            <div className="flex flex-col gap-2">
              <ul className="flex flex-col divide-y divide-border">
                {rows.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm">
                    <span className="flex min-w-0 flex-col">
                      <Link href={`/pos/transactions/${row.id}`} className="font-medium text-brand hover:underline">{row.receiptNumber}</Link>
                      <span className="text-xs text-text-muted">{formatDateTime(row.completedAt)} · {row.outlet.name}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="flex flex-col items-end">
                        <span className="font-semibold tabular-nums">{money(row.currency, row.total)}</span>
                        <span className="text-xs text-text-muted">
                          {row.paymentMethods.map((method) => METHOD[method] ?? method).join(", ") || "Paid"}
                          {Number(row.refunded) > 0 ? ` · ${money(row.currency, row.refunded)} refunded` : ""}
                        </span>
                      </span>
                      <StatusBadge tone={(STATUS[row.status] ?? [row.status, "neutral"])[1]}>{(STATUS[row.status] ?? [row.status])[0]}</StatusBadge>
                    </span>
                  </li>
                ))}
              </ul>
              {rows.length < (query.data?.total ?? 0) && (
                <Button variant="ghost" size="compact" className="self-center" onPress={() => setPages((value) => value + 1)}>Show older purchases</Button>
              )}
            </div>
          )}
    </Dialog>
  );
}
