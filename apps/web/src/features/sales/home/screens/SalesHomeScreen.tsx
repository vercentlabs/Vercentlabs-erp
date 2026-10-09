"use client";

// The Sales Overview, in CRM's shape: what needs doing now and what happened last. Four headline figures, the order work in progress and what
// needs attention side by side, the order pipeline by stage, and recent activity. Each figure is the count of a list view and opens that view,
// so the home never keeps a second copy of the records. Figures the person may not see are left out.
import { useQuery } from "@tanstack/react-query";
import { ErrorState, PermissionState } from "@vercentlabs/design-system";

import { dateTime, money } from "@/features/sales/shared/format";
import { request, SalesApiError } from "@/features/sales/shared/http";
import { SalesCreateMenu } from "@/features/sales/shared/SalesCreateMenu";
import { LoadingState } from "@/shared/ui/LoadingState";
import { ActivityList, CountList, OverviewCards, OverviewHeader, OverviewPanel, TileGrid } from "@/shared/ui/overview";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Activity = { id: string; at: string; kind: "quotation" | "order" | "delivery" | "invoice" | "return" | "credit_note"; documentId: string; number: string; verb: string; actor: string | null };
type SalesHome = {
  quotationsAwaitingResponse: number | null;
  orders: Record<string, number> | null;
  invoiceBalance: { invoices: number; outstanding: number; overdue: number; currencyCode: string | null } | null;
  activity: Activity[];
};

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
// The order pipeline, in the order an order moves through it (HOME_ORDER_VIEWS on the server).
const STAGES: Array<{ view: string; label: string; caption: string }> = [
  { view: "awaiting_reservation", label: "Awaiting reservation", caption: "Nothing reserved yet" },
  { view: "awaiting_delivery", label: "Awaiting delivery", caption: "Nothing delivered yet" },
  { view: "partially_delivered", label: "Partially delivered", caption: "Part still to deliver" },
  { view: "ready_to_invoice", label: "Ready to invoice", caption: "Something can be invoiced" },
  { view: "partially_invoiced", label: "Partially invoiced", caption: "Part still to invoice" },
];

export function SalesHomeScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "home"),
    queryFn: () => request<{ home: SalesHome }>("/home").then((r) => r.home),
  });
  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to Sales" description="Ask an administrator to grant sales.view." />;
  const home = query.data;
  const orders = home?.orders ?? null;
  const order = (view: string) => (orders ? orders[view] ?? 0 : null);
  const balance = home?.invoiceBalance ?? null;
  const currency = balance?.currencyCode ?? "";

  return (
    <div className="flex flex-1 flex-col gap-6">
      <OverviewHeader description="What needs doing now in Sales. Every number opens the list behind it." action={<SalesCreateMenu />} />
      {query.isLoading ? <LoadingState label="Loading Sales" rows={5} />
        : query.isError || !home ? <ErrorState title="Could not load the Sales overview" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />
        : (
          <>
            <OverviewCards label="Overview" cards={[
              { label: "Quotations awaiting response", value: home.quotationsAwaitingResponse, href: "/sales/quotations?view=awaiting" },
              { label: "Confirmed orders", value: order("confirmed"), href: "/sales/orders?view=confirmed" },
              { label: "Ready to invoice", value: order("ready_to_invoice"), href: "/sales/orders?view=ready_to_invoice" },
              { label: "Outstanding invoices", value: balance ? money(currency, balance.outstanding) : null, href: "/sales/invoices?view=balance_due" },
            ]} />

            <div className="grid gap-6 lg:grid-cols-2">
              <OverviewPanel title="Order work">
                <CountList empty="You cannot see sales orders." rows={[
                  { label: "Awaiting reservation", value: order("awaiting_reservation"), href: "/sales/orders?view=awaiting_reservation" },
                  { label: "Awaiting delivery", value: order("awaiting_delivery"), href: "/sales/orders?view=awaiting_delivery" },
                  { label: "Partially delivered", value: order("partially_delivered"), href: "/sales/orders?view=partially_delivered" },
                  { label: "Partially invoiced", value: order("partially_invoiced"), href: "/sales/orders?view=partially_invoiced" },
                ]} />
              </OverviewPanel>

              <OverviewPanel title="Needs attention">
                <CountList rows={[
                  { label: "Orders needing attention (short stock, late or ready to bill)", value: order("needs_attention"), href: "/sales/orders?view=needs_attention", tone: "warning" },
                  { label: "Overdue deliveries", value: order("overdue_delivery"), href: "/sales/orders?view=overdue_delivery", tone: "danger" },
                  { label: "Partially reserved (stock short)", value: order("partially_reserved"), href: "/sales/orders?view=partially_reserved", tone: "warning" },
                  { label: "Overdue invoice balance", value: balance ? money(currency, balance.overdue) : null, href: "/sales/invoices?view=overdue", tone: balance && balance.overdue > 0.005 ? "danger" : undefined },
                ]} />
              </OverviewPanel>
            </div>

            {orders && (
              <OverviewPanel title="Order pipeline">
                <TileGrid tiles={STAGES.map((stage) => ({ key: stage.view, label: stage.label, value: String(order(stage.view) ?? 0), caption: stage.caption, href: `/sales/orders?view=${stage.view}` }))} />
              </OverviewPanel>
            )}

            <OverviewPanel title="Recent activity">
              <ActivityList empty="Nothing has happened yet." entries={home.activity.map((entry) => ({
                key: `${entry.kind}:${entry.id}`, href: DOCUMENT_HREF[entry.kind](entry.documentId), title: `${KIND_LABELS[entry.kind]} ${entry.number}`, summary: entry.verb,
                meta: [entry.actor, dateTime(entry.at)].filter(Boolean).join(" · "),
              }))} />
            </OverviewPanel>
          </>
        )}
    </div>
  );
}
