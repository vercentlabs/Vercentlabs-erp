"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@vercentlabs/design-system";

import { AccountingApiError, readView } from "@/features/accounting/shared/client";
import { AccountingAlert, AccountingPanel } from "@/features/accounting/shared/AccountingUi";
import { label, money } from "@/features/accounting/shared/format";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

const SHORTCUTS = [
  ["Journal entries", "/accounting/journals"],
  ["Customer invoices", "/accounting/customer-invoices"],
  ["Receipts", "/accounting/receipts"],
  ["Supplier bills", "/accounting/supplier-invoices"],
  ["Payments", "/accounting/payments"],
  ["Bank statements", "/accounting/bank-transactions"],
  ["Tax returns", "/accounting/gst"],
  ["Period close", "/accounting/period-close"],
  ["Trial balance", "/accounting/trial-balance"],
] as const;
const COUNTS = /(posted|pending|count|open|exceptions|periods|assets)/i;

export function AccountingDashboardScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "dashboard"), queryFn: async () => (await readView<{ dashboard: Record<string, unknown> }>("dashboard")).dashboard });
  const error = query.error instanceof AccountingApiError ? query.error.message : query.isError ? "The dashboard could not be loaded." : null;
  const entries = Object.entries(query.data ?? {}).filter(([, v]) => v !== null && typeof v !== "object");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Accounting" description="Ledger, receivables, payables, banking, tax and close, in one place." />
      {error && <AccountingAlert>{error}</AccountingAlert>}
      <AccountingPanel title="At a glance">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {entries.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-text-muted">{label(k)}</dt>
              <dd className="text-xl font-semibold tabular-nums">{COUNTS.test(k) ? String(v) : money(v)}</dd>
            </div>
          ))}
        </dl>
      </AccountingPanel>
      <AccountingPanel title="Go to">
        <div className="flex flex-wrap gap-2">
          {SHORTCUTS.map(([text, href]) => (
            <Link key={href} href={href} className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm font-medium text-brand hover:bg-surface-hover">{text}</Link>
          ))}
        </div>
      </AccountingPanel>
    </div>
  );
}
