"use client";

// One cashier: Overview, Outlets, Permissions, Sessions, Transactions and History. Where they are working now comes from their open session;
// what they may do comes from their POS role (Cashier Permissions); nothing about cash or sales is stored on the profile.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, Button, Dialog, EmptyState, ErrorState, RecordDetailsPage, Select, StatusBadge, Tab, TabList, TabPanel, Tabs, TextArea } from "@vercentlabs/design-system";

import { ErrorBanner, money } from "@/features/items/item-format";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable, MoreActions } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { CashierPermissionsPanel } from "@/features/pos/permission-profiles/components/CashierPermissionsPanel";

import {
  CASHIERS_BASE, STATE_LABEL, STATE_TONE, blockersOf, deleteCashier, errorCode, errorMessage, getCashier, getCashierHistory, getCashierSessions, getCashierStatusCheck,
  getCashierTransactions, openPosForCashier, setCashierOutlets, setCashierStatus, setupIssuesOf, type Blocker, type CashierDetail, type OpenPosResult, type SetupIssue,
} from "../api/cashiers-api";

const TABS = ["overview", "outlets", "permissions", "sessions", "transactions", "history"] as const;
const STATUS_TONE: Record<string, "success" | "neutral" | "warning" | "danger" | "info"> = {
  open: "success", closing: "warning", closed: "neutral", completed: "success", partially_returned: "warning", returned: "neutral", voided: "danger",
  pending_approval: "warning", approved: "info", rejected: "danger", cancelled: "neutral", draft: "neutral",
};
const statusLabel = (status: string) => status.replace(/_/g, " ").replace(/^./, (first) => first.toUpperCase());

export function CashierDetailScreen({ cashierId, initialTab }: { cashierId: string; initialTab?: string | null }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<string>(() => (initialTab && (TABS as readonly string[]).includes(initialTab) ? initialTab : "overview"));
  const [dialog, setDialog] = useState<"deactivate" | "delete" | null>(null);
  const [choice, setChoice] = useState<Extract<OpenPosResult, { action: "open_session" }> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<SetupIssue[]>([]);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos-cashiers", "one", cashierId), queryFn: () => getCashier(cashierId) });
  const refresh = (message?: string) => {
    setError(null); setMissing([]);
    if (message) setNotice(message);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos-cashiers") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos-outlets") });
  };
  const activate = useMutation({
    mutationFn: () => setCashierStatus(cashierId, { status: "active" }), onSuccess: (saved) => refresh(saved.used ? "Reactivated." : "Activated. They can open POS at their outlets."),
    onError: (failure) => { setMissing(setupIssuesOf(failure)); setError(setupIssuesOf(failure).length ? null : errorMessage(failure)); },
  });
  const open = useMutation({
    mutationFn: () => openPosForCashier(cashierId),
    onSuccess: (result) => { if (result.action === "resume") router.push("/pos/checkout"); else setChoice(result); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const remove = useMutation({ mutationFn: () => deleteCashier(cashierId), onSuccess: () => { refresh(); router.push(CASHIERS_BASE); }, onError: (failure) => { setDialog(null); setError(errorMessage(failure)); } });

  if (query.isLoading) return <LoadingState label="Loading cashier" rows={6} />;
  if (query.isError) return errorCode(query.error) === "CASHIER_NOT_FOUND"
    ? <EmptyState title="Cashier not found" description="It may have been deleted, or it is not at one of your outlets." action={{ label: "All cashiers", onPress: () => router.push(CASHIERS_BASE) }} />
    : <ErrorState title="Could not load the cashier" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const cashier = query.data!;
  const can = cashier.capabilities;
  const self = cashier.userId === workspace.userId;
  const setup = missing.length ? missing : cashier.isActive ? [] : cashier.setup;
  const menu = [
    { id: "activate", label: cashier.used ? "Reactivate" : "Activate", run: () => activate.mutate(), show: can.status && !cashier.isActive },
    { id: "deactivate", label: "Deactivate", run: () => setDialog("deactivate"), show: can.status && cashier.isActive },
    { id: "delete", label: "Delete", run: () => setDialog("delete"), show: can.status && !cashier.used },
  ];

  return (
    <>
      <RecordDetailsPage
        header={{
          title: <>{cashier.name} <span className="text-base font-normal whitespace-nowrap text-text-muted">{cashier.code}</span></>,
          status: (
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={cashier.isActive ? "success" : "neutral"}>{cashier.isActive ? "Active" : "Inactive"}</StatusBadge>
              <StatusBadge tone={STATE_TONE[cashier.operationalState]}>{STATE_LABEL[cashier.operationalState]}</StatusBadge>
            </span>
          ),
          fields: [
            { label: "User", value: cashier.email },
            { label: "Default outlet", value: cashier.defaultOutlet ?? "None" },
            { label: "Permission profile", value: cashier.profileName ?? "None" },
            { label: "Now", value: cashier.currentTerminal ? `${cashier.currentOutlet} / ${cashier.currentTerminal}` : "Not on a session" },
          ],
          primaryAction: self && cashier.operable
            ? <Button variant="primary" isLoading={open.isPending} onPress={() => { setError(null); open.mutate(); }}>Open POS</Button> : undefined,
          secondaryActions: (
            <>
              {(can.edit || can.assignOutlets) && <Button variant="secondary" onPress={() => router.push(`${CASHIERS_BASE}/${cashier.id}/edit`)}>Edit</Button>}
              <MoreActions actions={menu.map((entry) => ({ ...entry, run: () => { setError(null); setNotice(null); entry.run(); } }))} />
            </>
          ),
        }}
        tabs={
          <div className="flex flex-col gap-3">
            <ErrorBanner message={error} />
            {notice && <Notice tone="success">{notice}</Notice>}
            {!cashier.userActive && <Notice tone="warning">Their workspace user is inactive, so this cashier cannot operate POS even though the profile is active.</Notice>}
            {setup.length > 0 && (
              <Notice tone={missing.length ? "danger" : "warning"}>
                <span className="font-medium">{missing.length ? "This cashier cannot be activated yet." : "Inactive. Before activating:"}</span>
                <ul className="mt-1 list-disc pl-5">{setup.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul>
              </Notice>
            )}
          </div>
        }
      >
        <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
          <TabList aria-label="Cashier sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="outlets">Outlets</Tab>
            <Tab id="permissions">Permissions</Tab>
            {can.viewSessions && <Tab id="sessions">Sessions</Tab>}
            {can.viewTransactions && <Tab id="transactions">Transactions</Tab>}
            <Tab id="history">History</Tab>
          </TabList>
          <TabPanel id="overview" className="pt-3"><Overview cashier={cashier} /></TabPanel>
          <TabPanel id="outlets" className="pt-3"><OutletsPanel cashier={cashier} onChanged={refresh} onError={setError} /></TabPanel>
          <TabPanel id="permissions" className="pt-3"><CashierPermissionsPanel cashierId={cashier.id} onChanged={() => refresh()} /></TabPanel>
          <TabPanel id="sessions" className="pt-3"><SessionsPanel cashier={cashier} /></TabPanel>
          <TabPanel id="transactions" className="pt-3"><TransactionsPanel cashier={cashier} /></TabPanel>
          <TabPanel id="history" className="pt-3"><HistoryPanel cashier={cashier} /></TabPanel>
        </Tabs>
      </RecordDetailsPage>

      {choice && (
        <Dialog isOpen onOpenChange={(isOpen) => !isOpen && setChoice(null)} title="Where are you working?">
          <div className="flex flex-col gap-3">
            {choice.outlets.every((outlet) => !outlet.terminals.length) && <p className="text-sm text-text-muted">No terminal is free at your outlets right now.</p>}
            {choice.outlets.map((outlet) => (
              <div key={outlet.outletId} className="flex flex-col gap-1">
                <span className="text-sm font-medium">{outlet.outlet}{outlet.isDefault ? " · default" : ""}</span>
                {outlet.terminals.length ? outlet.terminals.map((terminal) => (
                  <Button key={terminal.terminalId} variant="secondary" size="compact" onPress={() => router.push(`/pos/terminals/${terminal.terminalId}`)}>{terminal.terminal}</Button>
                )) : <span className="text-xs text-text-muted">No free terminal.</span>}
              </div>
            ))}
            <p className="text-xs text-text-muted">Choose a terminal, then open your session there.</p>
          </div>
        </Dialog>
      )}
      {dialog === "deactivate" && <DeactivateDialog cashier={cashier} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh("Deactivated. Their sessions and sales stay."); }} />}
      <AlertDialog isOpen={dialog === "delete"} onOpenChange={(isOpen) => !isOpen && setDialog(null)} title={`Delete ${cashier.code}?`}
        description="Only a cashier who never opened a session or recorded a sale can be deleted. Anyone else is deactivated, keeping their history." confirmLabel="Delete"
        isConfirming={remove.isPending} onConfirm={() => remove.mutate()} />
    </>
  );
}

function Overview({ cashier }: { cashier: CashierDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <FactList title="Cashier" items={[
        ["Cashier code", cashier.code], ["Name", cashier.fullName], ["Display name on receipts", cashier.displayName ?? cashier.fullName], ["User", cashier.email],
        ["Employee", cashier.employeeNumber], ["Status", cashier.isActive ? "Active" : "Inactive"], ["Default outlet", cashier.defaultOutlet],
        ["Permission profile", cashier.profileName ?? "None"], ["POS role", cashier.posRoles.join(", ") || "No POS role"], ["Notes", cashier.notes],
      ]} />
      <FactList title="Now" items={[
        ["Operational state", STATE_LABEL[cashier.operationalState]], ["Current outlet", cashier.currentOutlet], ["Current terminal", cashier.currentTerminal],
        ["Current session", cashier.currentSession], ["Business date", cashier.businessDate], ["Last activity", cashier.lastActivity ? formatDateTime(cashier.lastActivity) : null],
      ]} />
    </div>
  );
}

function OutletsPanel({ cashier, onChanged, onError }: { cashier: CashierDetail; onChanged: (message?: string) => void; onError: (message: string | null) => void }) {
  const change = useMutation({
    mutationFn: ({ outletIds, defaultOutletId }: { outletIds: string[]; defaultOutletId?: string | null }) => setCashierOutlets(cashier.id, outletIds, defaultOutletId),
    onSuccess: () => onChanged("Outlet access saved."), onError: (failure) => onError(errorMessage(failure)),
  });
  const manage = cashier.capabilities.assignOutlets;
  return (
    <Panel title="Outlets" description="Where this cashier may work. Add outlets under Edit; the outlet of an open session cannot be removed.">
      <LinesTable columns={["Outlet", "Default", "Since", "Granted by", ...(manage ? [""] : [])]} empty={cashier.outletAccess.length ? undefined : "No outlet yet: this cashier cannot work anywhere."}>
        {cashier.outletAccess.map((access) => (
          <tr key={access.outletId}>
            <Cell><Link className="font-medium text-brand hover:underline" href={`/pos/outlets/${access.outletId}`}>{access.outlet}</Link>{access.outletActive ? null : <span className="ml-2 text-xs text-text-muted">inactive</span>}</Cell>
            <Cell>{access.isDefault ? "Yes" : "No"}</Cell>
            <Cell>{formatDateTime(access.grantedAt)}</Cell>
            <Cell>{access.grantedBy}</Cell>
            {manage && (
              <Cell>
                <span className="flex justify-end gap-2">
                  {!access.isDefault && <Button variant="ghost" size="compact" onPress={() => change.mutate({ outletIds: cashier.outletIds, defaultOutletId: access.outletId })}>Make default</Button>}
                  <Button variant="ghost" size="compact" isDisabled={access.inSession} onPress={() => change.mutate({ outletIds: cashier.outletIds.filter((id) => id !== access.outletId) })}>
                    {access.inSession ? "Open session here" : "Remove"}
                  </Button>
                </span>
              </Cell>
            )}
          </tr>
        ))}
      </LinesTable>
    </Panel>
  );
}

function SessionsPanel({ cashier }: { cashier: CashierDetail }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos-cashiers", "sessions", cashier.id), queryFn: () => getCashierSessions(cashier.id), enabled: cashier.capabilities.viewSessions });
  const cash = cashier.capabilities.viewCash;
  const amount = (value: number | null | undefined) => (value === null || value === undefined ? null : money(value));
  return (
    <Panel title="Sessions" description="The open session first. Opening and closing happen under Sessions / Shifts.">
      {query.isLoading ? <LoadingState label="Loading sessions" rows={3} /> : query.isError ? <ErrorBanner message={errorMessage(query.error)} /> : (
        <LinesTable columns={["Session", "Business date", "Outlet", "Terminal", "Opened", "Closed", ...(cash ? [{ label: "Opening cash", numeric: true }, { label: "Expected", numeric: true },
          { label: "Counted", numeric: true }, { label: "Difference", numeric: true }] : []), "Status"]} empty={query.data?.length ? undefined : "No sessions yet."}>
          {(query.data ?? []).map((row) => (
            <tr key={row.id}>
              <Cell><Link className="font-medium text-brand hover:underline" href={`/pos/shifts/${row.id}`}>{row.number}</Link></Cell>
              <Cell>{row.businessDate}</Cell>
              <Cell>{row.outlet}</Cell>
              <Cell>{row.terminal}</Cell>
              <Cell>{row.openedAt ? formatDateTime(row.openedAt) : null}</Cell>
              <Cell>{row.closedAt ? formatDateTime(row.closedAt) : null}</Cell>
              {cash && <Cell numeric>{amount(row.openingCash)}</Cell>}
              {cash && <Cell numeric>{amount(row.expectedCash)}</Cell>}
              {cash && <Cell numeric>{amount(row.countedCash)}</Cell>}
              {cash && <Cell numeric className={row.difference ? "text-danger" : undefined}>{amount(row.difference)}</Cell>}
              <Cell><StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>{statusLabel(row.status)}</StatusBadge></Cell>
            </tr>
          ))}
        </LinesTable>
      )}
    </Panel>
  );
}

function TransactionsPanel({ cashier }: { cashier: CashierDetail }) {
  const workspace = useWorkspaceContext();
  const [kind, setKind] = useState("all");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos-cashiers", "transactions", cashier.id, kind),
    queryFn: () => getCashierTransactions(cashier.id, { kind: kind === "all" ? undefined : kind }), enabled: cashier.capabilities.viewTransactions });
  return (
    <div className="flex flex-col gap-3">
      <Select aria-label="Transactions" size="compact" className="w-48" selectedKey={kind} onSelectionChange={(key) => setKind(String(key))}
        options={[{ value: "all", label: "Sales and returns" }, { value: "sales", label: "Sales" }, { value: "returns", label: "Returns" }]} />
      {query.isLoading ? <LoadingState label="Loading transactions" rows={3} /> : query.isError ? <ErrorBanner message={errorMessage(query.error)} /> : (
        <LinesTable columns={["Receipt", "Date / time", "Outlet", "Terminal", "Session", "Customer", { label: "Amount", numeric: true }, "Payment", "Status"]}
          empty={query.data?.length ? undefined : "No transactions yet."}>
          {(query.data ?? []).map((row) => (
            <tr key={`${row.kind}-${row.id}`}>
              <Cell>{row.kind === "sale" ? <Link className="font-medium text-brand hover:underline" href={`/pos/transactions/${row.id}`}>{row.number}</Link>
                : <span className="font-medium">{row.number} <span className="text-xs text-text-muted">return</span></span>}</Cell>
              <Cell>{row.at ? formatDateTime(row.at) : null}</Cell>
              <Cell>{row.outlet}</Cell>
              <Cell>{row.terminal}</Cell>
              <Cell>{row.session}</Cell>
              <Cell>{row.customer}</Cell>
              <Cell numeric>{money(row.amount)}</Cell>
              <Cell>{row.payment}</Cell>
              <Cell><StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>{statusLabel(row.status)}</StatusBadge></Cell>
            </tr>
          ))}
        </LinesTable>
      )}
    </div>
  );
}

function HistoryPanel({ cashier }: { cashier: CashierDetail }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos-cashiers", "history", cashier.id), queryFn: () => getCashierHistory(cashier.id) });
  if (query.isLoading) return <LoadingState label="Loading history" rows={3} />;
  if (query.isError) return <ErrorBanner message={errorMessage(query.error)} />;
  return <HistoryList title={null} empty="No changes recorded yet." entries={(query.data ?? []).map((row) => ({
    summary: row.summary, at: row.createdAt, actor: row.actorName, detail: row.reason ? <span className="text-sm text-text-secondary">Reason: {row.reason}</span> : undefined,
  }))} />;
}

// Deactivation waits for the cashier's open session.
function DeactivateDialog({ cashier, onClose, onDone }: { cashier: CashierDetail; onClose: () => void; onDone: () => void }) {
  const workspace = useWorkspaceContext();
  const [reason, setReason] = useState("");
  const [blockers, setBlockers] = useState<Blocker[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const check = useQuery({ queryKey: scopedQueryKey(workspace, "pos-cashiers", "status-check", cashier.id), queryFn: () => getCashierStatusCheck(cashier.id) });
  const run = useMutation({
    mutationFn: () => setCashierStatus(cashier.id, { status: "inactive", reason: reason.trim() || undefined }),
    onSuccess: onDone, onError: (failure) => { setBlockers(blockersOf(failure)); setError(errorMessage(failure)); },
  });
  const shown = blockers ?? check.data?.blockers ?? [];
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={`Deactivate ${cashier.code}?`}>
      <div className="flex flex-col gap-3">
        {check.isLoading ? <LoadingState label="Checking" rows={2} /> : shown.length ? (
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-medium">It cannot be deactivated yet:</p>
            <ul className="list-disc pl-5">{shown.map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}</ul>
          </div>
        ) : <p className="text-sm">They will not be able to open a session, sell or take returns. Their sessions and sales stay, and the same profile can be reactivated.</p>}
        {!shown.length && <ErrorBanner message={error} />}
        {!shown.length && <TextArea label="Reason" rows={2} value={reason} onChange={setReason} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>{shown.length ? "Close" : "Cancel"}</Button>
          {!shown.length && <Button variant="danger" isLoading={run.isPending} onPress={() => run.mutate()}>Deactivate</Button>}
        </div>
      </div>
    </Dialog>
  );
}
