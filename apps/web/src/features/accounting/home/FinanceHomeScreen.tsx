"use client";

// The Finance home: where the money is (cash and bank, what customers owe, what is owed to suppliers and employees), this month's results
// beside last month's, what needs attention — each item linking to where it is fixed — the month next to close, and quick actions.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CircleAlert, Info } from "lucide-react";
import { ErrorState, LinkButton, PageHeader, PermissionState, StatusBadge } from "@vercentlabs/design-system";

import { AccountingApiError } from "@/features/accounting/shared/client";
import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Attention = { key: string; severity: "danger" | "warning" | "info"; count: number; amount?: number; label: string; detail?: string | null; href: string };
type Home = {
  today: string;
  cash: { total: number; inTransit: number; accounts: Array<{ id: string; name: string; kind: "bank" | "cash"; bankName: string | null; accountNumber: string | null; ledgerAccountId: string; balance: number }> };
  receivables: { owed: number; overdue: number; overdueCount: number };
  payables: { owed: number; overdue: number; dueThisWeek: number; dueThisWeekCount: number };
  expensesOwed: { amount: number; count: number };
  results: null | { month: { from: string; to: string; revenue: number; expenses: number; profit: number }; previous: { from: string; to: string; revenue: number; expenses: number; profit: number } };
  attention: Attention[];
  nextToClose: { id: string; name: string; status: string } | null;
};

async function loadHome(): Promise<Home> {
  const response = await fetch("/api/accounting/home", { credentials: "same-origin", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AccountingApiError(payload.message || "The Finance home could not be loaded.", response.status, payload.code);
  return payload.home as Home;
}
const inr = (value: number) => value.toLocaleString("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 0 });

export function FinanceHomeScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "home"), queryFn: loadHome });
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  if (query.isLoading) return <LoadingState label="Loading Finance" rows={8} />;
  if (query.error instanceof AccountingApiError && query.error.status === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  if (!query.data) return <ErrorState title="Could not load Finance" description={query.error instanceof Error ? query.error.message : ""} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const home = query.data;
  const actions = [
    can("accounting.receipts.manage") && ["Record receipt", "/accounting/receipts/new"],
    can("accounting.payments.manage") && ["Pay supplier", "/accounting/payments/new"],
    can("accounting.payables.manage") && ["Record expense", "/accounting/expenses/new"],
    can("accounting.journal.create") && ["New journal", "/accounting/journals/new"],
    can("accounting.bank.manage") && ["Import bank statement", "/accounting/reconciliation/import"],
  ].filter(Boolean) as Array<[string, string]>;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Finance" description={`Where the money is and what needs attention, as of ${formatDate(home.today)}.`}
        primaryAction={home.nextToClose ? <LinkButton variant="secondary" href={`/accounting/close/${home.nextToClose.id}`}>Close {home.nextToClose.name}<ArrowRight className="size-4" aria-hidden="true" /></LinkButton> : undefined} />

      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <Figure label="Cash and bank" value={inr(home.cash.total)} note={home.cash.inTransit ? `incl. ${inr(home.cash.inTransit)} in transit` : `${home.cash.accounts.length} account${home.cash.accounts.length === 1 ? "" : "s"}`} href="/accounting/bank-accounts" />
        <Figure label="Customers owe" value={inr(home.receivables.owed)} note={home.receivables.overdue > 0 ? `${inr(home.receivables.overdue)} overdue (${home.receivables.overdueCount})` : "Nothing overdue"}
          tone={home.receivables.overdue > 0 ? "warning" : undefined} href="/accounting/receivables-aging" />
        <Figure label="We owe suppliers" value={inr(home.payables.owed)} note={home.payables.dueThisWeek > 0 ? `${inr(home.payables.dueThisWeek)} due this week (${home.payables.dueThisWeekCount})` : home.payables.overdue > 0 ? `${inr(home.payables.overdue)} overdue` : "Nothing due this week"}
          tone={home.payables.overdue > 0 ? "warning" : undefined} href="/accounting/payables-aging" />
        <Figure label="Expenses still owed" value={inr(home.expensesOwed.amount)} note={`${home.expensesOwed.count} to pay (suppliers and employees)`} href="/accounting/expenses" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Panel title="Needs attention" description="What stands between the books and a clean close. Each links to where it is fixed.">
            {home.attention.length === 0 ? <Notice tone="success">Nothing needs attention: every document is in the books and the sub-ledgers agree.</Notice> : (
              <ul className="flex flex-col divide-y divide-border">
                {home.attention.map((item) => (
                  <li key={item.key}>
                    <Link href={item.href} className="flex items-start justify-between gap-3 py-2.5 hover:bg-surface-hover">
                      <span className="flex min-w-0 gap-2">
                        {item.severity === "danger" ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
                          : item.severity === "warning" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" /> : <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />}
                        <span className="flex min-w-0 flex-col"><span className="text-sm font-medium text-text">{item.label}</span>
                          {item.detail && <span className="text-xs text-text-muted">{item.detail}</span>}</span>
                      </span>
                      <span className="shrink-0 text-sm tabular-nums text-text-secondary">{item.amount ? inr(item.amount) : ""}<ArrowRight className="ml-1 inline size-3.5" aria-hidden="true" /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {home.results && (
            <Panel title="This month" description={`${formatDate(home.results.month.from)} – ${formatDate(home.results.month.to)}, beside last month.`}
              actions={<Link className="text-sm text-brand underline" href="/accounting/profit-loss">Profit & Loss</Link>}>
              <dl className="grid grid-cols-3 gap-3">
                {(["revenue", "expenses", "profit"] as const).map((key) => (
                  <div key={key} className="flex flex-col gap-0.5">
                    <dt className="text-xs text-text-muted">{key === "revenue" ? "Revenue" : key === "expenses" ? "Expenses" : "Profit"}</dt>
                    <dd className={`text-lg font-semibold tabular-nums ${key === "profit" && home.results!.month.profit < 0 ? "text-danger" : "text-text"}`}>{inr(home.results!.month[key])}</dd>
                    <dd className="text-xs text-text-muted">Last month {inr(home.results!.previous[key])}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          )}
        </div>
        <div className="flex flex-col gap-4">
          {actions.length > 0 && (
            <Panel title="Quick actions">
              <div className="flex flex-col gap-2">
                {actions.map(([label, href]) => <LinkButton key={href} variant="secondary" href={href} className="justify-start">{label}</LinkButton>)}
              </div>
            </Panel>
          )}
          <Panel title="Cash and bank" actions={<Link className="text-sm text-brand underline" href="/accounting/bank-accounts">All accounts</Link>}>
            {home.cash.accounts.length === 0 ? <p className="text-sm text-text-muted">No bank or cash account yet.</p> : (
              <ul className="flex flex-col divide-y divide-border">
                {home.cash.accounts.map((account) => (
                  <li key={account.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <Link className="min-w-0 truncate text-text hover:text-brand hover:underline" href={`/accounting/bank-accounts/${account.id}`}>{account.name}
                      <span className="block text-xs text-text-muted">{account.kind === "cash" ? "Cash" : [account.bankName, account.accountNumber].filter(Boolean).join(" · ")}</span></Link>
                    <span className={`shrink-0 tabular-nums ${account.balance < 0 ? "text-danger" : "text-text"}`}>{inr(account.balance)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {home.nextToClose && (
            <Panel title="Month end">
              <p className="text-sm text-text-secondary">Next to close: <Link className="font-medium text-brand underline" href={`/accounting/close/${home.nextToClose.id}`}>{home.nextToClose.name}</Link>{" "}
                <StatusBadge tone={home.nextToClose.status === "soft_closed" ? "warning" : "info"}>{home.nextToClose.status === "soft_closed" ? "Closing review" : "Open"}</StatusBadge></p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function Figure({ label, value, note, href, tone }: { label: string; value: string; note: string; href: string; tone?: "warning" }) {
  return (
    <Link href={href} className={`flex min-w-0 flex-col gap-1 rounded-[var(--radius-panel)] border p-3 hover:border-brand sm:p-4 ${tone === "warning" ? "border-warning-emphasis/30 bg-warning-soft" : "border-border bg-surface"}`}>
      <span className="text-xs text-text-muted">{label}</span>
      <span className="truncate text-lg font-semibold tabular-nums text-text sm:text-2xl">{value}</span>
      <span className="text-xs text-text-secondary">{note}</span>
    </Link>
  );
}
