"use client";

// Payment Reconciliation: one Finance workspace over every card / UPI payment and refund — paid, provider-matched, settled and received in the
// bank are shown apart (a sale is never "unpaid" because its money has not reached the bank yet). Runs, the exception queue, settlements and
// bank receipts, merchant accounts and reports. Cashiers see a payment's plain status at the counter instead.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, PageHeader, PermissionState, Select, StatusBadge, Tab, TabList, TabPanel, Tabs, TextField } from "@vercentlabs/design-system";

import {
  CODE_LABEL, merchantAccounts, overview, reportCsv, saveMerchant, startRun, type MerchantAccount,
} from "@/features/pos/payment-reconciliation/api/reconciliation-api";
import { ExceptionsPanel } from "@/features/pos/payment-reconciliation/components/ExceptionsPanel";
import { SettlementsPanel } from "@/features/pos/payment-reconciliation/components/SettlementsPanel";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime, money } from "@/features/pos/shared/format";
import { PosAlert, PosLoading, PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function PaymentReconciliationScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("overview");
  const key = scopedQueryKey(workspace, "payment-reconciliation", "overview");
  const query = useQuery({ queryKey: key, queryFn: () => overview({}), retry: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (query.isLoading) return <PosLoading label="Loading payment reconciliation…" />;
  if (query.isError || !query.data) {
    if (query.error instanceof PosApiError && query.error.status === 403) return <PermissionState title="You cannot view payment reconciliation" description="Ask Finance or an outlet manager for access." />;
    return <PosAlert>{query.error instanceof PosApiError ? query.error.message : "Could not load payment reconciliation."}</PosAlert>;
  }
  const data = query.data;
  const t = data.totals;
  const run = async () => {
    setBusy(true); setError(null);
    try { const result = await startRun({ runType: "ALL", idempotencyKey: crypto.randomUUID() }); if (result.status !== "COMPLETED") setError(result.error ?? "The run failed."); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "payment-reconciliation") }); }
    catch (failure) { setError(failure instanceof PosApiError ? failure.message : "The run could not start."); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Payment Reconciliation" description={`${data.from} to ${data.to}. Customer payments, provider evidence, settlements and bank receipts — each kept apart.`}
        primaryAction={<Button variant="primary" isLoading={busy} onPress={run}>Run reconciliation</Button>} />
      {error && <PosAlert>{error}</PosAlert>}
      <Tabs selectedKey={tab} onSelectionChange={(value) => setTab(String(value))}>
        <TabList aria-label="Reconciliation sections">
          <Tab id="overview">Overview</Tab>
          <Tab id="exceptions">{`Exceptions (${data.exceptions.open})`}</Tab>
          <Tab id="settlements">Settlements &amp; bank</Tab>
          <Tab id="merchants">Merchant accounts</Tab>
          <Tab id="reports">Reports</Tab>
        </TabList>
        <TabPanel id="overview">
          <div className="flex flex-col gap-4 pt-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[["Paid by customers", t.paid], ["Provider-matched", t.providerMatched], ["Awaiting provider", t.awaitingProvider], ["Awaiting settlement", t.awaitingSettlement],
                ["Settled", t.settled], ["Awaiting bank match", t.awaitingBankMatch], ["Received in bank", t.bankReceived], ["Collected, not applied", t.unapplied]].map(([label, value]) => (
                <div key={label} className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2"><p className="text-xs text-text-muted">{label}</p>
                  <p className="text-base font-semibold tabular-nums">{money("INR", value ?? 0)}</p></div>
              ))}
            </div>
            <p className="text-xs text-text-muted">Settlement fees {money("INR", t.settlementFees ?? 0)} across {t.settlementBatches} payout(s) · {t.financePosted} posted to Finance{t.financeFailed ? ` · ${t.financeFailed} failed` : ""}. Fees never reduce a sale.</p>
            <div className="grid gap-4 lg:grid-cols-2">
              <PosPanel title="By method">
                <ul className="text-sm">{data.byMethod.map((row) => <li key={row.method}>{row.method.toUpperCase()} · {row.count} · {money("INR", row.amount ?? 0)} paid · {money("INR", row.settled ?? 0)} settled</li>)}</ul>
              </PosPanel>
              <PosPanel title={`Open exceptions · ${money("INR", data.exceptions.exposure ?? 0)} exposure`}>
                <p className="text-sm text-text-muted">Age: {Object.entries(data.exceptions.aging).map(([bucket, count]) => `${bucket} ${count}`).join(" · ")}</p>
                <ul className="text-sm">{data.exceptions.byCode.map((row) => <li key={row.code}>{CODE_LABEL[row.code] ?? row.code}: {row.count} · {money("INR", row.exposure ?? 0)}</li>)}</ul>
              </PosPanel>
            </div>
            <PosPanel title="Recent exceptions">
              <ul className="text-sm">{data.exceptions.recent.map((row) => (
                <li key={row.id} className="flex flex-wrap gap-2"><span className="font-medium">{row.number}</span><span>{CODE_LABEL[row.code] ?? row.code}</span>
                  <span className="tabular-nums">{row.exposure ? money(row.currency, row.exposure) : ""}</span><StatusBadge tone="warning">{row.status.toLowerCase().replace(/_/g, " ")}</StatusBadge></li>
              ))}</ul>
            </PosPanel>
            <PosPanel title="Runs">
              <ul className="text-sm">{data.runs.map((row) => <li key={row.id}>{dateTime(row.startedAt)} · {row.runType.toLowerCase()} · {row.status.toLowerCase()} · {row.processed} checked · {row.matched} matched · {row.exceptions} new exceptions · {row.resolved} cleared{row.error ? ` · ${row.error}` : ""}</li>)}</ul>
            </PosPanel>
          </div>
        </TabPanel>
        <TabPanel id="exceptions"><div className="pt-4"><ExceptionsPanel /></div></TabPanel>
        <TabPanel id="settlements"><div className="pt-4"><SettlementsPanel /></div></TabPanel>
        <TabPanel id="merchants"><div className="pt-4"><MerchantAccountsPanel /></div></TabPanel>
        <TabPanel id="reports"><div className="pt-4"><ReportsPanel /></div></TabPanel>
      </Tabs>
    </div>
  );
}

function MerchantAccountsPanel() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "payment-reconciliation", "merchants");
  const query = useQuery({ queryKey: key, queryFn: merchantAccounts, retry: false });
  const [error, setError] = useState<string | null>(null);
  const save = async (account: MerchantAccount, changes: Partial<MerchantAccount>) => {
    setError(null);
    try { await saveMerchant({ id: account.id, paymentMethods: account.paymentMethods, bankAccountId: account.bankAccountId, settlementExpectedDays: account.settlementExpectedDays, ...changes }); await queryClient.invalidateQueries({ queryKey: key }); }
    catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Could not save."); }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">Each provider merchant account, the Finance bank account its payouts reach, and how many days settlement normally takes (after that, a missing settlement or bank receipt becomes an exception).</p>
      {(query.data?.merchantAccounts ?? []).map((account) => (
        <div key={account.id} className="flex flex-wrap items-end gap-3 border-t border-border pt-3 text-sm">
          <span className="min-w-[14rem] font-medium">{account.displayName}<span className="block text-xs text-text-muted">{account.providerKey} · {account.merchantAccountReference} · {account.paymentMethods.join(", ")}</span></span>
          <Select label="Bank account" size="compact" selectedKey={account.bankAccountId ?? "none"} onSelectionChange={(value) => void save(account, { bankAccountId: value === "none" ? null : String(value) })}
            options={[{ value: "none", label: "Not set" }, ...(query.data?.bankAccounts ?? []).map((bank) => ({ value: bank.id, label: `${bank.code} · ${bank.bankName}` }))]} />
          <TextField label="Settlement days" size="compact" defaultValue={String(account.settlementExpectedDays)} className="sm:max-w-[8rem]"
            onBlur={(blurEvent) => { const days = Number((blurEvent.target as HTMLInputElement).value); if (Number.isInteger(days) && days !== account.settlementExpectedDays) void save(account, { settlementExpectedDays: days }); }} />
        </div>
      ))}
      {error && <PosAlert>{error}</PosAlert>}
    </div>
  );
}

const REPORTS = [["summary", "Reconciliation summary"], ["unmatched", "Unmatched payments"], ["duplicates", "Duplicate / excess payments"], ["unknown", "Unknown payments"],
  ["settlements", "Provider settlements"], ["settlement_aging", "Settlement aging"], ["refunds", "Refund reconciliation"], ["bank_unmatched", "Payouts not in the bank"],
  ["manual_matches", "Manual match audit"], ["cash_links", "Cash discrepancy links"], ["clearing", "Clearing balances"], ["day_end", "Day-End reconciliation status"]] as const;

function ReportsPanel() {
  const [type, setType] = useState("summary");
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    setError(null);
    try {
      const csv = await reportCsv(type);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const link = document.createElement("a");
      link.href = url; link.download = `payment-reconciliation-${type}.csv`; link.click();
      URL.revokeObjectURL(url);
    } catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Could not export."); }
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select label="Report" size="compact" selectedKey={type} onSelectionChange={(value) => setType(String(value))} options={REPORTS.map(([value, label]) => ({ value, label }))} />
      <Button size="compact" variant="secondary" onPress={download}>Download CSV</Button>
      {error && <PosAlert>{error}</PosAlert>}
    </div>
  );
}
