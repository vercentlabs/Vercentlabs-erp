"use client";

// The Sales home: what needs doing now and what happened last. Each figure
// is the count of a list view and opens that view, so the home never keeps a
// second copy of the records. Figures the person may not see are left out.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, PageHeader, PermissionState } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { request, SalesApiError } from "@/features/sales/shared/http";
import { dateTime, money } from "@/features/sales/shared/format";
import { SalesPanel } from "@/features/sales/shared/SalesUi";
import { SalesCreateMenu } from "@/features/sales/shared/SalesCreateMenu";

type Activity = { id: string; at: string; kind: "quotation" | "order" | "delivery" | "invoice" | "return" | "credit_note"; documentId: string; number: string; verb: string; actor: string | null };
type SalesHome = {
  quotationsAwaitingResponse: number | null;
  orders: Record<string, number> | null;
  invoiceBalance: { invoices: number; outstanding: number; overdue: number; currencyCode: string | null } | null;
  activity: Activity[];
};

// The order list views the home counts (HOME_ORDER_VIEWS on the server), with the label and hint shown here.
const ORDER_TILES: Array<{ view: string; label: string; hint: string; attention?: boolean }> = [
  { view: "confirmed", label: "Confirmed orders", hint: "In execution" },
  { view: "awaiting_reservation", label: "Awaiting reservation", hint: "Nothing reserved yet", attention: true },
  { view: "partially_reserved", label: "Partially reserved", hint: "Stock short for part of the order", attention: true },
  { view: "awaiting_delivery", label: "Awaiting delivery", hint: "Nothing delivered yet" },
  { view: "partially_delivered", label: "Partially delivered", hint: "Part still to deliver" },
  { view: "overdue_delivery", label: "Overdue deliveries", hint: "Requested date has passed", attention: true },
  { view: "ready_to_invoice", label: "Ready to invoice", hint: "Something can be invoiced now", attention: true },
  { view: "partially_invoiced", label: "Partially invoiced", hint: "Part still to invoice" },
  { view: "needs_attention", label: "Needs attention", hint: "Short stock, late, or ready to bill", attention: true },
];
const DOCUMENT_HREF: Record<Activity["kind"], (id: string) => string> = {
  quotation: (id) => `/sales/quotations/${id}`,
  order: (id) => `/sales/orders/${id}`,
  delivery: (id) => `/sales/deliveries/${id}`,
  invoice: (id) => `/sales/invoices/${id}`,
  return: (id) => `/sales/returns/${id}`,
  credit_note: (id) => `/sales/credit-notes/${id}`,
};
const KIND_LABELS: Record<Activity["kind"], string> = {
  quotation: "Quotation", order: "Sales order", delivery: "Delivery", invoice: "Invoice", return: "Return", credit_note: "Credit note",
};

function Tile({ href, label, value, hint, attention }: { href: string; label: string; value: string; hint: string; attention?: boolean }) {
  const active = attention && value !== "0";
  return (
    <li>
      <Link href={href}
        className="flex h-full flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none">
        <span className="text-sm text-text-secondary">{label}</span>
        <span className={`text-2xl font-semibold tabular-nums ${active ? "text-warning" : "text-text"}`}>{value}</span>
        <span className="text-xs text-text-muted">{hint}</span>
      </Link>
    </li>
  );
}

export function SalesHomeScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "home"),
    queryFn: () => request<{ home: SalesHome }>("/home").then((r) => r.home),
  });
  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to Sales" description="Ask an administrator to grant sales.view." />;
  const home = query.data;
  const count = (value: number | null | undefined) => (value === null || value === undefined ? "…" : String(value));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Sales" description="What needs doing now. Each figure opens the list it counts." primaryAction={<SalesCreateMenu />} />
      {query.isError ? (
        <ErrorState title="Could not load the Sales home" action={{ label: "Retry", onPress: () => query.refetch() }} />
      ) : (
        <>
          <ul aria-label="Sales work" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(!home || home.quotationsAwaitingResponse !== null) && (
              <Tile href="/sales/quotations?view=awaiting" label="Quotations awaiting response" value={count(home?.quotationsAwaitingResponse)} hint="Sent and still valid" />
            )}
            {(!home || home.orders) && ORDER_TILES.map((tile) => (
              <Tile key={tile.view} href={`/sales/orders?view=${tile.view}`} label={tile.label} value={count(home?.orders?.[tile.view])} hint={tile.hint} attention={tile.attention} />
            ))}
            {home?.invoiceBalance && (
              <Tile href="/sales/invoices?view=balance_due" label="Outstanding invoice balance" value={money(home.invoiceBalance.currencyCode ?? "", home.invoiceBalance.outstanding)}
                hint={`${home.invoiceBalance.invoices} invoice${home.invoiceBalance.invoices === 1 ? "" : "s"}${home.invoiceBalance.overdue > 0.005 ? ` · ${money(home.invoiceBalance.currencyCode ?? "", home.invoiceBalance.overdue)} overdue` : ""}`} />
            )}
          </ul>
          <SalesPanel title="Recent activity" description="Confirmations, dispatches, postings, received returns and credit notes.">
            {!home ? <p className="text-sm text-text-muted">Loading…</p> : !home.activity.length ? <p className="text-sm text-text-muted">Nothing yet.</p> : (
              <ol className="flex flex-col divide-y divide-border text-sm">
                {home.activity.map((entry) => (
                  <li key={`${entry.kind}:${entry.id}`} className="grid grid-cols-1 gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[11rem_minmax(0,1fr)]">
                    <span className="whitespace-nowrap tabular-nums text-text-muted">{dateTime(entry.at)}</span>
                    <span>
                      <span className="text-text-muted">{KIND_LABELS[entry.kind]} </span>
                      <Link className="font-medium tabular-nums text-brand hover:underline" href={DOCUMENT_HREF[entry.kind](entry.documentId)}>{entry.number}</Link>
                      {" "}{entry.verb}{entry.actor ? <span className="text-text-muted"> · {entry.actor}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </SalesPanel>
        </>
      )}
    </div>
  );
}
