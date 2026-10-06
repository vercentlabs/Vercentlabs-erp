"use client";

// The Sales "+ Create" menu. A customer, a quotation and a sales order start
// from scratch. Every later document keeps its lineage: a delivery or an
// invoice starts from a sales order, a return from a dispatched delivery, a
// credit note from a posted invoice and a refund from the customer's credit.
// Choosing one of those asks for the source document first, then opens the
// source with its own create dialog (?create=…), where the usual checks run.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button, Dialog, Menu, MenuItem, MenuSeparator, MenuTrigger, SearchField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { request } from "@/features/sales/shared/http";

type Source = { id: string; number: string; detail: string };
type Picker = {
  key: string; label: string; permission: string; title: string; description: string;
  // The list endpoint (under /api/sales) that returns the eligible sources, and how a row reads.
  path: string; read: (row: Record<string, unknown>) => Source; open: (id: string) => string;
};

const STARTS = [
  { key: "/sales/customers/new", label: "Customer", permission: "sales.customers.create" },
  { key: "/sales/quotations/new", label: "Quotation", permission: "sales.quotation.create" },
  { key: "/sales/orders/new", label: "Sales Order", permission: "sales.order.create" },
];
const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const PICKERS: Picker[] = [
  {
    key: "delivery", label: "Delivery", permission: "sales.fulfillment.request", title: "New delivery", description: "Choose the confirmed sales order with goods still to deliver.",
    path: "/orders?deliverable=true&sort=date&direction=desc", open: (id) => `/sales/orders/${id}?create=delivery`,
    read: (row) => ({ id: text(row.id), number: text(row.sales_order_number), detail: [row.customer_name, row.customer_po_number && `PO ${text(row.customer_po_number)}`].filter(Boolean).join(" · ") }),
  },
  {
    key: "invoice", label: "Invoice", permission: "sales.invoice.request", title: "New invoice", description: "Choose the sales order with something ready to invoice. To invoice one delivery, open the delivery instead.",
    path: "/orders?readyToInvoice=true&sort=date&direction=desc", open: (id) => `/sales/orders/${id}?create=invoice`,
    read: (row) => ({ id: text(row.id), number: text(row.sales_order_number), detail: [row.customer_name, row.customer_po_number && `PO ${text(row.customer_po_number)}`].filter(Boolean).join(" · ") }),
  },
  {
    key: "return", label: "Sales Return", permission: "sales.return.create", title: "New sales return", description: "Choose the dispatched or delivered delivery the goods came back from.",
    path: "/deliveries?shipped=true&sort=dispatch&direction=desc", open: (id) => `/sales/deliveries/${id}?create=return`,
    read: (row) => ({ id: text(row.id), number: text(row.delivery_number), detail: [row.customer_name, row.sales_order_number].filter(Boolean).join(" · ") }),
  },
  {
    key: "credit", label: "Credit Note", permission: "sales.credit_note.create", title: "New credit note", description: "Choose the posted invoice to credit. For returned goods, start from the sales return.",
    path: "/invoices?view=posted&sort=date&direction=desc", open: (id) => `/sales/invoices/${id}?create=credit`,
    read: (row) => ({ id: text(row.id), number: text(row.invoice_number), detail: [row.customer_name, row.sales_order_number].filter(Boolean).join(" · ") }),
  },
];

export function SalesCreateMenu({ size = "standard" }: { size?: "compact" | "standard" }) {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const [picking, setPicking] = useState<Picker | null>(null);
  const holds = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const starts = STARTS.filter((entry) => holds(entry.permission));
  const pickers = PICKERS.filter((entry) => holds(entry.permission));
  const refunds = holds("accounting.refund.create");
  if (!starts.length && !pickers.length && !refunds) return null;
  return (
    <>
      <MenuTrigger>
        <Button variant="primary" size={size}>
          <Plus className="size-4" aria-hidden="true" />
          Create
        </Button>
        <Menu onAction={(key) => {
          const picker = PICKERS.find((entry) => entry.key === key);
          if (picker) setPicking(picker);
          else router.push(String(key));
        }}>
          {starts.map((entry) => <MenuItem key={entry.key} id={entry.key}>{entry.label}</MenuItem>)}
          {starts.length > 0 && (pickers.length > 0 || refunds) ? <MenuSeparator /> : null}
          {pickers.map((entry) => <MenuItem key={entry.key} id={entry.key}>{`${entry.label}…`}</MenuItem>)}
          {/* A refund starts from a customer's refundable credit, chosen in the refund dialog. */}
          {refunds ? <MenuItem id="/sales/refunds?create=1">Refund…</MenuItem> : null}
        </Menu>
      </MenuTrigger>
      {picking && <SourcePicker picker={picking} onClose={() => setPicking(null)} onPick={(id) => { setPicking(null); router.push(picking.open(id)); }} />}
    </>
  );
}

function SourcePicker({ picker, onClose, onPick }: { picker: Picker; onClose: () => void; onPick: (id: string) => void }) {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "create-source", picker.key, term),
    queryFn: () => request<{ rows: Array<Record<string, unknown>> }>(`${picker.path}&limit=20${term ? `&search=${encodeURIComponent(term)}` : ""}`).then((r) => r.rows.map(picker.read)),
  });
  const rows = query.data ?? [];
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={picker.title} description={picker.description}>
      <div className="flex flex-col gap-3">
        <SearchField label="Search" value={search} onChange={setSearch} autoFocus placeholder="Number, customer or customer PO" />
        {query.isLoading ? <p className="text-sm text-text-muted">Loading…</p>
          : query.isError ? <p className="text-sm text-danger">Could not load the documents. Try again.</p>
            : !rows.length ? <p className="text-sm text-text-muted">{term ? "Nothing matches." : "There is nothing to start from yet."}</p> : (
              <ul className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto" aria-label="Documents to start from">
                {rows.map((row) => (
                  <li key={row.id}>
                    <button type="button" onClick={() => onPick(row.id)}
                      className="flex w-full flex-col items-start gap-0.5 px-2 py-2 text-left text-sm hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none">
                      <span className="font-medium tabular-nums text-text">{row.number}</span>
                      {row.detail ? <span className="text-xs text-text-muted">{row.detail}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
        <div className="flex justify-end"><Button variant="secondary" onPress={onClose}>Cancel</Button></div>
      </div>
    </Dialog>
  );
}
