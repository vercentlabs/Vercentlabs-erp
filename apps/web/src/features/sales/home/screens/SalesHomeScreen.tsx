"use client";

// The Sales home, built like CRM Home: it answers "what do I do next?". Top to bottom: a greeting with today's line; the four headline
// figures (orders, sales and collections today, the month against its target); what needs action — the rows with something to do
// stand out, the clear ones fade — beside the money owed and the customers most overdue, each with a WhatsApp reminder; the order
// pipeline as numbered stages; and what just happened, grouped by day. Phones get one column (the stages scroll sideways), tablets pair
// the side panels, desktops keep them beside the work list. Every figure and row opens the list or document behind it, and figures the
// person may not see are left out.
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { CalendarCheck, ReceiptText, ShoppingCart, Wallet } from "lucide-react";
import { ErrorState, PageHeader, PermissionState } from "@vercentlabs/design-system";

import { calendarDate, compactMoney, money } from "@/features/sales/shared/format";
import { WhatsAppSendButton } from "@/features/sales/shared/WhatsAppSend";
import { request, SalesApiError } from "@/features/sales/shared/http";
import { SalesCreateMenu } from "@/features/sales/shared/SalesCreateMenu";
import { LoadingState } from "@/shared/ui/LoadingState";
import { ActivityTimeline, AllClear, AttentionList, greeting, HomePanel, homeClock, Kpi, PanelLink, type AttentionRow } from "@/shared/ui/home";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { useApp } from "@/shell/workspace-context/useApp";

type Activity = { id: string; at: string; kind: "quotation" | "order" | "delivery" | "invoice" | "return" | "credit_note"; documentId: string; number: string; verb: string; actor: string | null };
type SalesHome = {
  quotationsAwaitingResponse: number | null;
  orders: Record<string, number> | null;
  invoiceBalance: { invoices: number; outstanding: number; overdue: number; currencyCode: string | null } | null;
  money: { invoicedToday: number; invoicedThisMonth: number; dueToday: number; dueTodayCount: number; currencyCode: string | null;
    topOverdue: Array<{ customerId: string; name: string | null; amount: number; oldestDue: string }> } | null;
  today?: { ordersToday: number | null; orderValueToday: number | null; collectedToday: number | null; monthTarget: number | null; einvoicePending: number | null };
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
  quotation: "quotation", order: "sales order", delivery: "delivery", invoice: "invoice", return: "return", credit_note: "credit note",
};
// The order pipeline, in the order an order moves through it (HOME_ORDER_VIEWS on the server).
const STAGES: Array<{ view: string; label: string; caption: string }> = [
  { view: "awaiting_reservation", label: "Stock to keep aside", caption: "Nothing kept aside yet" },
  { view: "awaiting_delivery", label: "To deliver", caption: "Nothing delivered yet" },
  { view: "partially_delivered", label: "Partly delivered", caption: "Part still to deliver" },
  { view: "ready_to_invoice", label: "Ready to invoice", caption: "Something can be billed" },
  { view: "partially_invoiced", label: "Partly invoiced", caption: "Part still to bill" },
];

export function SalesHomeScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "home"),
    queryFn: () => request<{ home: SalesHome }>("/home").then((r) => r.home),
    refetchOnWindowFocus: true,
  });
  const stockOn = useApp("stock");
  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to Sales" description="Ask an administrator to grant sales.view." />;
  const home = query.data;
  const firstName = workspace.fullName.split(" ")[0] || workspace.fullName;
  const clock = homeClock();
  const rows = home ? attentionRows(home, stockOn) : [];
  const toAct = rows.filter((row) => (row.value ?? 0) > 0).length;
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 md:gap-6">
      <PageHeader title={home ? `${greeting(clock.hour)}, ${firstName}` : `Welcome back, ${firstName}`}
        description={home ? `${clock.today} · ${toAct ? `${toAct} ${toAct === 1 ? "thing needs" : "things need"} action` : "nothing needs action"}` : "Sales at a glance."}
        primaryAction={<SalesCreateMenu />} />
      {query.isLoading ? <LoadingState label="Loading Sales" rows={5} />
        : query.isError || !home ? <ErrorState title="Could not load the Sales home" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />
        : <HomeBody home={home} rows={rows} stockOn={stockOn} day={clock.ymd} />}
    </div>
  );
}

function attentionRows(home: SalesHome, stockOn: boolean): AttentionRow[] {
  const orders = home.orders;
  const order = (view: string) => (orders ? orders[view] ?? 0 : null);
  const cash = home.money;
  const balance = home.invoiceBalance;
  return [
    { label: "Orders held for credit", value: order("credit_hold"), href: "/sales/orders?view=credit_hold", tone: "danger" },
    { label: "Overdue deliveries", value: order("overdue_delivery"), href: "/sales/orders?view=overdue_delivery", tone: "danger" },
    { label: "Overdue collections", value: balance ? balance.overdue : null, display: balance ? money(balance.currencyCode ?? "INR", balance.overdue) : undefined,
      href: "/sales/outstanding", tone: "danger" },
    { label: "Orders to confirm", value: order("to_confirm"), href: "/sales/orders?view=to_confirm", tone: "warning" },
    ...(stockOn ? [{ label: "Orders to dispatch", value: order("to_dispatch"), href: "/sales/orders?view=to_dispatch", tone: "warning" as const }] : []),
    { label: "Orders to bill", value: order("to_bill"), href: "/sales/orders?view=to_bill", tone: "warning" },
    { label: "Invoices waiting for their IRN", value: home.today?.einvoicePending ?? null, href: "/sales/gst-documents", tone: "warning" },
    { label: `Collections due today${cash?.dueTodayCount ? ` (${cash.dueTodayCount})` : ""}`, value: cash ? cash.dueToday : null,
      display: cash ? money(cash.currencyCode ?? "INR", cash.dueToday) : undefined, href: "/sales/invoices?view=due_today", tone: "warning" },
    { label: "Quotations awaiting the customer's answer", value: home.quotationsAwaitingResponse, href: "/sales/quotations?view=awaiting", tone: "warning" },
    ...(stockOn ? [{ label: "Partly kept aside (stock short)", value: order("partially_reserved"), href: "/sales/orders?view=partially_reserved", tone: "warning" as const }] : []),
  ];
}

function HomeBody({ home, rows, stockOn, day }: { home: SalesHome; rows: AttentionRow[]; stockOn: boolean; day: string }) {
  const cash = home.money;
  const today = home.today;
  const balance = home.invoiceBalance;
  const currency = cash?.currencyCode ?? balance?.currencyCode ?? "INR";
  const target = today?.monthTarget ?? null;
  const achieved = target && cash ? Math.round((cash.invoicedThisMonth / target) * 100) : null;
  const flagged = rows.filter((row) => (row.value ?? 0) > 0).length;
  return (
    <>
      <section aria-label="Headline figures" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {today?.orderValueToday != null && (
          <Kpi icon={<ShoppingCart />} tone="brand" label="Orders today" value={compactMoney(currency, today.orderValueToday)} title={money(currency, today.orderValueToday)}
            href={`/sales/orders?f.dateFrom=${day}&f.dateTo=${day}`} caption={today.ordersToday ? `${today.ordersToday} ${today.ordersToday === 1 ? "order" : "orders"}` : "No orders yet today"} />
        )}
        {cash && (
          <Kpi icon={<ReceiptText />} tone="brand" label="Sales today" value={compactMoney(currency, cash.invoicedToday)} title={money(currency, cash.invoicedToday)}
            href={`/sales/reports?tab=sales&report=sales-register&from=${day}&to=${day}`} caption="Invoiced today" />
        )}
        {today?.collectedToday != null && (
          <Kpi icon={<Wallet />} tone="success" label="Collected today" value={compactMoney(currency, today.collectedToday)} title={money(currency, today.collectedToday)}
            href={`/sales/payments?from=${day}&to=${day}`}
            caption={cash?.dueToday ? `${compactMoney(currency, cash.dueToday)} due today` : "Nothing due today"} />
        )}
        {cash && (
          <Kpi icon={<CalendarCheck />} tone={achieved !== null && achieved >= 100 ? "success" : "brand"} label="This month" value={compactMoney(currency, cash.invoicedThisMonth)}
            title={money(currency, cash.invoicedThisMonth)} href="/sales/reports?tab=sales&report=sales-by-period" progress={target ? achieved : undefined}
            caption={target ? `${achieved}% of the ${compactMoney(currency, target)} target` : "Invoiced so far"} captionTone={achieved !== null && achieved >= 100 ? "success" : undefined} />
        )}
        {!cash && (
          <>
            <Kpi icon={<ReceiptText />} tone="brand" label="Quotations awaiting answer" value={home.quotationsAwaitingResponse ?? 0} href="/sales/quotations?view=awaiting" />
            <Kpi icon={<ShoppingCart />} tone="brand" label="Confirmed orders" value={home.orders?.confirmed ?? 0} href="/sales/orders?view=confirmed" />
          </>
        )}
      </section>

      <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 md:gap-6 lg:col-span-2">
          <HomePanel grow title="Needs action" description={flagged ? `${flagged} ${flagged === 1 ? "list has" : "lists have"} something to do` : "Nothing is waiting on you"}
            action={<PanelLink href="/sales/orders">All orders</PanelLink>}>
            {flagged === 0 && <AllClear title="You're all caught up" description="No order, delivery, bill or payment needs action now." />}
            <AttentionList rows={rows} />
          </HomePanel>
        </div>
        {/* Tablets pair these under the work list; desktops stack them beside it. */}
        <div className="grid min-w-0 content-start gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-1">
          {balance && <OwedPanel balance={balance} />}
          {cash && <OverduePanel cash={cash} />}
        </div>
      </div>

      {home.orders && <PipelinePanel orders={home.orders} stockOn={stockOn} />}

      <HomePanel title="Recent activity" description="The latest changes on quotations, orders, deliveries and invoices you can see">
        <ActivityTimeline empty="Nothing has happened yet." entries={home.activity.map((entry) => ({
          key: `${entry.kind}:${entry.id}`, at: entry.at, actor: entry.actor, verb: entry.verb, recordLabel: KIND_LABELS[entry.kind], recordName: entry.number,
          href: DOCUMENT_HREF[entry.kind](entry.documentId),
        }))} />
      </HomePanel>
    </>
  );
}

// What customers owe: the total and the overdue share, as a bar.
function OwedPanel({ balance }: { balance: NonNullable<SalesHome["invoiceBalance"]> }) {
  const currency = balance.currencyCode ?? "INR";
  const share = balance.outstanding > 0 ? Math.round((balance.overdue / balance.outstanding) * 100) : 0;
  return (
    <HomePanel title="Money to collect" description={balance.invoices ? `${balance.invoices} ${balance.invoices === 1 ? "invoice" : "invoices"} unpaid` : "No unpaid invoices"}
      action={<PanelLink href="/sales/outstanding">Open</PanelLink>}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-2xl font-semibold tabular-nums" title={money(currency, balance.outstanding)}>{compactMoney(currency, balance.outstanding)}</span>
        <span className={`text-sm tabular-nums ${balance.overdue > 0.005 ? "font-medium text-danger" : "text-text-muted"}`}>
          {balance.overdue > 0.005 ? `${compactMoney(currency, balance.overdue)} overdue` : "None overdue"}
        </span>
      </div>
      <span className="flex h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
        {balance.outstanding > 0 && <span className="h-full bg-danger" style={{ width: `${share}%` }} />}
        {balance.outstanding > 0 && <span className="h-full bg-brand" style={{ width: `${100 - share}%` }} />}
      </span>
      {balance.outstanding > 0 && <p className="text-xs text-text-muted">{`${share}% is overdue`}</p>}
    </HomePanel>
  );
}

// The customers owing the most overdue, each with its amount, since when, and a WhatsApp reminder.
function OverduePanel({ cash }: { cash: NonNullable<SalesHome["money"]> }) {
  const currency = cash.currencyCode ?? "INR";
  return (
    <HomePanel title="Most overdue" description="Customers owing the most past the due date" action={<PanelLink href="/sales/outstanding">All</PanelLink>}>
      {cash.topOverdue.length === 0 ? <AllClear title="No customer is overdue" /> : (
        <ul className="flex flex-col divide-y divide-border">
          {cash.topOverdue.map((entry) => (
            <li key={entry.customerId} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:gap-3 md:flex-col md:items-stretch xl:flex-row xl:items-center">
              <Link href={`/sales/customers/${entry.customerId}?tab=ledger`} className="flex min-w-0 flex-1 flex-col hover:text-brand">
                <span className="truncate text-sm font-medium">{entry.name ?? "Customer"}</span>
                <span className="text-xs text-text-muted">{`Overdue since ${calendarDate(entry.oldestDue)}`}</span>
              </Link>
              <span className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold tabular-nums text-danger">{money(currency, entry.amount)}</span>
                <WhatsAppSendButton kind="reminder" id={entry.customerId} size="compact" label="Remind" />
              </span>
            </li>
          ))}
        </ul>
      )}
    </HomePanel>
  );
}

// The order pipeline as one row of numbered stages, in the order an order moves: each stage's count and its share of the orders in
// flight. Stages fill the row on a tablet and desktop; a phone scrolls them sideways.
function PipelinePanel({ orders, stockOn }: { orders: Record<string, number>; stockOn: boolean }) {
  const stages = STAGES.filter((stage) => stockOn || stage.view !== "awaiting_reservation").map((stage) => ({ ...stage, count: orders[stage.view] ?? 0 }));
  const total = stages.reduce((sum, stage) => sum + stage.count, 0);
  const shade = (index: number) => 1 - (index / Math.max(stages.length, 2)) * 0.65;
  return (
    <HomePanel title="Order pipeline" description={total ? `${total} confirmed ${total === 1 ? "order is" : "orders are"} on their way to the customer` : "No orders in flight"}
      action={<PanelLink href="/sales/orders">Open orders</PanelLink>}>
      <ol className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:overflow-visible sm:px-0 sm:pb-0"
        style={{ gridTemplateColumns: `repeat(auto-fit, minmax(9.5rem, 1fr))` }}>
        {stages.map((stage, index) => {
          const share = total > 0 ? Math.round((stage.count / total) * 100) : 0;
          const empty = stage.count === 0;
          return (
            <li key={stage.view} className="w-40 shrink-0 snap-start sm:w-auto">
              <Link href={`/sales/orders?view=${stage.view}`}
                className={`group flex h-full flex-col gap-1.5 rounded-[var(--radius-control)] border p-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand ${empty
                  ? "border-dashed border-border bg-surface hover:bg-surface-muted" : "border-border bg-surface hover:border-border-strong hover:bg-surface-muted"}`}>
                <span className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                  <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-brand text-[10px] font-semibold text-white" style={{ opacity: shade(index) }} aria-hidden="true">{index + 1}</span>
                  <span className="truncate" title={stage.label}>{stage.label}</span>
                </span>
                <span className={`text-lg font-semibold tabular-nums ${empty ? "text-text-muted" : "text-text"}`}>{empty ? "—" : stage.count}</span>
                <span className="flex items-center justify-between gap-2 text-xs text-text-muted">
                  <span className="truncate">{empty ? "None" : stage.caption}</span>
                  {!empty && <span className="tabular-nums">{share}%</span>}
                </span>
                <span className="mt-auto h-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                  <span className="block h-full rounded-full bg-brand" style={{ width: `${share}%`, opacity: shade(index) }} />
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </HomePanel>
  );
}
