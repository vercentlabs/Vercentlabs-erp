"use client";

// Bought or made for this order (Sales report Phase 3): what the order's "buy" and "make" lines raised when it was confirmed — a purchase
// indent, draft purchase orders or draft manufacturing orders — or why a line could not be raised, to do by hand.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { request } from "@/features/sales/shared/http";
import { Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Supply = { sequence: number; itemName: string | null; route: "buy" | "make"; quantity: number; documentType: "purchase_indent" | "purchase_order" | "manufacturing_order" | null;
  documentId: string | null; documentNumber: string | null; error: string | null; at: string };

const LINKS = { purchase_indent: ["Purchase indent", "/procurement/indents/"], purchase_order: ["Draft purchase order", "/procurement/purchase-orders/"],
  manufacturing_order: ["Draft manufacturing order", "/manufacturing/orders/"] } as const;

export function SupplyPanel({ orderId }: { orderId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "order-supply", orderId),
    queryFn: () => request<{ supply: Supply[] }>(`/orders/${orderId}/supply`).then((result) => result.supply) });
  const rows = query.data ?? [];
  if (!rows.length) return null;
  return (
    <Panel title="Bought or made for this order" description="Raised when the order was confirmed.">
      <ul className="flex flex-col divide-y divide-border text-sm">
        {rows.map((row) => (
          <li key={`${row.at}-${row.sequence}-${row.route}`} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <span className="min-w-0">
              <span className="font-medium">{`Line ${row.sequence}`}</span>
              <span className="text-text-secondary">{` · ${row.itemName ?? "Item"} · ${row.quantity} · ${row.route === "buy" ? "Buy" : "Make"}`}</span>
            </span>
            {row.documentType && row.documentId ? (
              <Link className="text-accent hover:underline" href={`${LINKS[row.documentType][1]}${row.documentId}`}>{`${LINKS[row.documentType][0]} ${row.documentNumber ?? ""}`.trim()}</Link>
            ) : <span className="text-danger">{row.error ?? "Not raised."}</span>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
