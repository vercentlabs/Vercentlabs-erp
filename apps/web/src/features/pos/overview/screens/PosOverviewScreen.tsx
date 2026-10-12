"use client";

// POS Overview: today at the outlets the person works at — sales and their tenders, the counters open now, what needs attention (payments
// and checkouts without an outcome, refunds still open, cash differences, payment exceptions, held bills) and each outlet's business day —
// with quick actions. Cashiers (no manager reports) land on their work instead: the Register while their shift is open, otherwise Open Shift.
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ShoppingCart } from "lucide-react";
import { ErrorState, LinkButton, MetricStrip, PageHeader, StatusBadge } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { getPosDashboard } from "@/features/pos/overview/api/overview-api";
import { currentShift } from "@/features/pos/shift-opening/api/shift-opening-api";
import { dateTime, money } from "@/features/pos/shared/format";
import { PosLoading, PosPanel } from "@/features/pos/shared/PosUi";
import { CountList } from "@/shared/ui/overview";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const METHOD: Record<string, string> = { cash: "Cash", card: "Card", upi: "UPI", wallet: "Wallet", bank_transfer: "Bank transfer", store_credit: "Store credit" };
const DAY: Record<string, { label: string; tone: "success" | "warning" | "info" | "danger" }> = {
  OPEN: { label: "Open", tone: "info" }, CLOSING: { label: "Closing", tone: "warning" }, BLOCKED: { label: "Blocked", tone: "danger" },
  READY_TO_FINALIZE: { label: "Ready to close", tone: "warning" }, CLOSED: { label: "Closed", tone: "success" },
};

export function PosOverviewScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const manager = can(POS_PERMISSIONS.reportView) || can("pos.reports.view") || can(POS_PERMISSIONS.storeManage);
  const shiftQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "shifts", "current"), queryFn: currentShift });
  const dashboard = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "dashboard"), queryFn: getPosDashboard, enabled: manager, refetchInterval: 60_000 });
  const shift = shiftQuery.data ?? null;

  // A cashier's first screen is their work: the Register while their shift is open, otherwise Open Shift.
  useEffect(() => {
    if (manager || shiftQuery.isLoading) return;
    router.replace(shift ? "/pos/register" : "/pos/shifts?tab=current");
  }, [manager, shift, shiftQuery.isLoading, router]);
  if (!manager) return <PosLoading label="Opening your counter…" />;

  const data = dashboard.data;
  const attention = data?.attention;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Point of Sale" description="Today at your outlets: sales, open counters and anything that needs attention."
        primaryAction={shift
          ? <LinkButton variant="primary" href="/pos/register"><ShoppingCart className="size-4" aria-hidden="true" />Open Register</LinkButton>
          : can(POS_PERMISSIONS.shiftOpen) ? <LinkButton variant="primary" href="/pos/shifts?tab=current">Open shift</LinkButton> : undefined} />
      {dashboard.isError && <ErrorState title="Could not load the POS overview" description="Check your connection and try again." action={{ label: "Retry", onPress: () => void dashboard.refetch() }} />}
      <MetricStrip metrics={[
        { label: "Sales today", value: data?.sales_today ?? "—" },
        { label: "Sales value today", value: data ? money("", data.revenue_today) : "—" },
        { label: "Open counters", value: data?.open_shifts ?? "—" },
        { label: "Returns today", value: data?.returns_today ?? "—" },
      ]} />
      {dashboard.isLoading ? <PosLoading label="Loading today…" /> : data && attention && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <PosPanel title="Payments today" description="Collected, by tender">
            {data.tenders.length ? (
              <ul className="flex flex-col gap-1 text-sm">{data.tenders.map((row) => (
                <li key={row.method} className="flex justify-between"><span>{METHOD[row.method] ?? row.method}</span><span className="tabular-nums">{money("", row.amount)} · {row.payments}</span></li>
              ))}</ul>
            ) : <p className="text-sm text-text-muted">No payments yet today.</p>}
            <Link className="text-xs text-brand underline" href="/pos/reports?tab=payments">Payment reports</Link>
          </PosPanel>
          <PosPanel title="Needs attention">
            <CountList empty="Nothing needs attention." rows={[
              { label: "Payments without an outcome", value: attention.pendingPayments, href: "/pos/transactions?tab=payments", tone: "danger" as const },
              { label: "Checkouts in progress", value: attention.pendingCheckouts, href: "/pos/held-carts", tone: "warning" as const },
              { label: "Payment exceptions", value: attention.openPaymentExceptions, href: "/pos/transactions?tab=payments", tone: "danger" as const },
              { label: "Refunds still open", value: attention.openRefunds, href: "/pos/returns?tab=refunds", tone: "warning" as const },
              { label: "Cash differences open", value: attention.openCashDifferences, href: "/pos/shifts?tab=exceptions", tone: "warning" as const },
              { label: "Held bills", value: attention.heldCarts, href: "/pos/held-carts" },
            ].filter((row) => row.value)} />
          </PosPanel>
          <PosPanel title="Business day">
            {data.businessDays.length ? (
              <ul className="flex flex-col gap-1.5 text-sm">{data.businessDays.map((day) => (
                <li key={day.outletId} className="flex items-center justify-between gap-2">
                  <span>{day.outlet} · {day.businessDate}</span>
                  <StatusBadge tone={DAY[day.status]?.tone ?? "info"}>{DAY[day.status]?.label ?? day.status}</StatusBadge>
                </li>
              ))}</ul>
            ) : <p className="text-sm text-text-muted">No business day started yet.</p>}
            {can(POS_PERMISSIONS.reportView) && <Link className="text-xs text-brand underline" href="/pos/day-end">Day-End / Z Reports</Link>}
          </PosPanel>
        </div>
      )}
      {data && (
        <PosPanel title="Counters open now" description={data.activeShifts.length ? undefined : "No counter is open."}>
          {data.activeShifts.length > 0 && (
            <ul className="flex flex-col divide-y divide-border text-sm">{data.activeShifts.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span><Link className="font-medium text-brand underline" href={`/pos/shifts/${row.id}`}>{row.number}</Link> · {row.outlet} · {row.terminal}</span>
                <span className="text-text-secondary">{row.cashier ?? "—"} · since {dateTime(row.openedAt)}{row.status === "closing" ? " · closing" : ""}</span>
              </li>
            ))}</ul>
          )}
        </PosPanel>
      )}
      <PosPanel title="Quick actions">
        <div className="flex flex-wrap gap-2">
          <LinkButton variant="secondary" size="compact" href="/pos/register">Register</LinkButton>
          <LinkButton variant="secondary" size="compact" href="/pos/transactions">Find a transaction</LinkButton>
          <LinkButton variant="secondary" size="compact" href="/pos/returns">Returns &amp; refunds</LinkButton>
          <LinkButton variant="secondary" size="compact" href="/pos/stock">Stock lookup</LinkButton>
          <LinkButton variant="secondary" size="compact" href="/pos/shifts">Shifts &amp; cash</LinkButton>
          {can(POS_PERMISSIONS.reportView) && <LinkButton variant="secondary" size="compact" href="/pos/day-end">Close the day</LinkButton>}
        </div>
      </PosPanel>
    </div>
  );
}
