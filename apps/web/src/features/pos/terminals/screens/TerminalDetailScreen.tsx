"use client";

// One POS terminal: Overview, Setup, Sessions, Transactions and History. Who is working on it now comes from its open session; what it sells
// from, its prices, tax and payment methods are its effective configuration (its own overrides, then its outlet's).
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
import { ScannerSettingsPanel } from "@/features/pos/products/scanner/ScannerSettingsPanel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  STATE_LABEL, STATE_TONE, TERMINALS_BASE, blockersOf, deleteTerminal, errorCode, errorMessage, getTerminal, getTerminalHistory, getTerminalSessions, getTerminalStatusCheck,
  getTerminalTransactions, openPos, setTerminalStatus, setupIssuesOf, type Blocker, type SetupIssue, type TerminalDetail,
} from "../api/terminals-api";

const TABS = ["overview", "setup", "sessions", "transactions", "history"] as const;
const SOURCE: Record<string, string> = { terminal: "this terminal", outlet: "the outlet", warehouse: "the warehouse default", company: "the company default", none: "no cash" };
const STATUS_TONE: Record<string, "success" | "neutral" | "warning" | "danger" | "info"> = {
  open: "success", closing: "warning", closed: "neutral", completed: "success", partially_returned: "warning", returned: "neutral", voided: "danger",
  pending_approval: "warning", approved: "info", rejected: "danger", cancelled: "neutral", draft: "neutral",
};
const statusLabel = (status: string) => status.replace(/_/g, " ").replace(/^./, (first) => first.toUpperCase());

export function TerminalDetailScreen({ terminalId, initialTab }: { terminalId: string; initialTab?: string | null }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { permissions, roleSlugs } = workspace;
  const [tab, setTab] = useState<string>(() => (initialTab && (TABS as readonly string[]).includes(initialTab) ? initialTab : "overview"));
  const [dialog, setDialog] = useState<"deactivate" | "delete" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<SetupIssue[]>([]);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos-terminals", "one", terminalId), queryFn: () => getTerminal(terminalId) });
  const refresh = (message?: string) => {
    setError(null); setMissing([]);
    if (message) setNotice(message);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos-terminals") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos-outlets") });
  };
  const activate = useMutation({
    mutationFn: () => setTerminalStatus(terminalId, { status: "active" }), onSuccess: () => refresh("Activated. Authorized cashiers can open a session on it."),
    onError: (failure) => { setMissing(setupIssuesOf(failure)); setError(setupIssuesOf(failure).length ? null : errorMessage(failure)); },
  });
  const open = useMutation({
    mutationFn: () => openPos(terminalId),
    onSuccess: (result) => router.push(result.action === "resume" ? "/pos/checkout" : "/pos/shifts"),
    onError: (failure) => setError(errorMessage(failure)),
  });
  const remove = useMutation({ mutationFn: () => deleteTerminal(terminalId), onSuccess: () => { refresh(); router.push(TERMINALS_BASE); }, onError: (failure) => { setDialog(null); setError(errorMessage(failure)); } });

  if (query.isLoading) return <LoadingState label="Loading terminal" rows={6} />;
  if (query.isError) return errorCode(query.error) === "TERMINAL_NOT_FOUND"
    ? <EmptyState title="Terminal not found" description="It may have been deleted, or it is not at one of your outlets." action={{ label: "All terminals", onPress: () => router.push(TERMINALS_BASE) }} />
    : <ErrorState title="Could not load the terminal" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const terminal = query.data!;
  const can = terminal.capabilities;
  const operator = roleSlugs.includes("organization_owner") || ["pos.operate", "pos.shift.open", "pos.sale.create"].some((key) => permissions.includes(key));
  const configures = can.edit || can.configureInventory || can.configureCash || can.configurePayments || can.configureNumbering || can.configureHardware;
  const setup = missing.length ? missing : terminal.isActive ? [] : terminal.setup;
  const menu = [
    { id: "activate", label: "Activate", run: () => activate.mutate(), show: can.status && !terminal.isActive },
    { id: "deactivate", label: "Deactivate", run: () => setDialog("deactivate"), show: can.status && terminal.isActive },
    { id: "delete", label: "Delete", run: () => setDialog("delete"), show: can.status && !terminal.used },
  ];

  return (
    <>
      <RecordDetailsPage
        header={{
          title: <>{terminal.name} <span className="text-base font-normal whitespace-nowrap text-text-muted">{terminal.code}</span></>,
          status: (
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={terminal.isActive ? "success" : "neutral"}>{terminal.isActive ? "Active" : "Inactive"}</StatusBadge>
              <StatusBadge tone={STATE_TONE[terminal.operationalState]}>{STATE_LABEL[terminal.operationalState]}</StatusBadge>
            </span>
          ),
          fields: [
            { label: "Outlet", value: terminal.outlet ? <Link className="text-brand hover:underline" href={`/pos/outlets/${terminal.outletId}`}>{terminal.outlet}</Link> : "Not set" },
            { label: "Current cashier", value: terminal.currentCashier ?? "None" },
            { label: "Current session", value: terminal.currentSession ?? "None" },
            { label: "Last activity", value: terminal.lastActivity ? formatDateTime(terminal.lastActivity) : "Never" },
          ],
          primaryAction: operator && terminal.operable
            ? <Button variant="primary" isLoading={open.isPending} onPress={() => { setError(null); open.mutate(); }}>Open POS</Button> : undefined,
          secondaryActions: (
            <>
              {configures && <Button variant="secondary" onPress={() => router.push(`${TERMINALS_BASE}/${terminal.id}/edit`)}>Set up</Button>}
              <MoreActions actions={menu.map((entry) => ({ ...entry, run: () => { setError(null); setNotice(null); entry.run(); } }))} />
            </>
          ),
        }}
        tabs={
          <div className="flex flex-col gap-3">
            <ErrorBanner message={error} />
            {notice && <Notice tone="success">{notice}</Notice>}
            {!terminal.outletActive && <Notice tone="warning">Its outlet is inactive, so this terminal cannot be used even though it is active.</Notice>}
            {setup.length > 0 && (
              <Notice tone={missing.length ? "danger" : "warning"}>
                <span className="font-medium">{missing.length ? "This terminal cannot be activated yet." : "Inactive. Before activating:"}</span>
                <ul className="mt-1 list-disc pl-5">{setup.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul>
              </Notice>
            )}
          </div>
        }
      >
        <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
          <TabList aria-label="Terminal sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="setup">Setup</Tab>
            {can.viewSessions && <Tab id="sessions">Sessions</Tab>}
            {can.viewTransactions && <Tab id="transactions">Transactions</Tab>}
            <Tab id="history">History</Tab>
          </TabList>
          <TabPanel id="overview" className="pt-3"><Overview terminal={terminal} /></TabPanel>
          <TabPanel id="setup" className="pt-3"><SetupPanel terminal={terminal} /></TabPanel>
          <TabPanel id="sessions" className="pt-3"><SessionsPanel terminal={terminal} /></TabPanel>
          <TabPanel id="transactions" className="pt-3"><TransactionsPanel terminal={terminal} /></TabPanel>
          <TabPanel id="history" className="pt-3"><HistoryPanel terminal={terminal} /></TabPanel>
        </Tabs>
      </RecordDetailsPage>

      {dialog === "deactivate" && <DeactivateDialog terminal={terminal} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh("Deactivated. Its sessions and sales stay."); }} />}
      <AlertDialog isOpen={dialog === "delete"} onOpenChange={(isOpen) => !isOpen && setDialog(null)} title={`Delete ${terminal.code}?`}
        description="Only a terminal that has never had a session, cart or sale can be deleted. Anything else is deactivated, keeping its history." confirmLabel="Delete"
        isConfirming={remove.isPending} onConfirm={() => remove.mutate()} />
    </>
  );
}

function Overview({ terminal }: { terminal: TerminalDetail }) {
  const effective = terminal.effective;
  return (
    <div className="flex flex-col gap-4">
      <FactList title="Now" items={[
        ["Status", terminal.isActive ? "Active" : "Inactive"], ["Operational state", STATE_LABEL[terminal.operationalState]],
        ["Current session", terminal.currentSession], ["Current cashier", terminal.currentCashier], ["Business date", terminal.businessDate],
        ["Last sale", terminal.lastSaleAt ? formatDateTime(terminal.lastSaleAt) : null],
      ]} />
      <FactList title="Configuration" items={[
        ["Warehouse", effective.warehouse], ["Selling location", effective.sellingLocation.label ? `${effective.sellingLocation.label} (from ${SOURCE[effective.sellingLocation.source]})` : "Warehouse default"],
        ["Cash management", terminal.cashManagementEnabled ? "Enabled" : "Not handled here"],
        ["Payment methods", effective.paymentMethods.map((method) => method.label).join(" · ") || "None"],
        ["Price list", effective.priceList.label ?? "Company default"], ["GST registration", effective.taxRegistration.label],
        ["Receipt series", effective.receiptPrefix],
      ]} />
    </div>
  );
}

function SetupPanel({ terminal }: { terminal: TerminalDetail }) {
  const effective = terminal.effective;
  const inherited = (value: string | null | undefined, source: string) => (value ? `${value} · from ${SOURCE[source] ?? source}` : `From ${SOURCE[source] ?? source}`);
  return (
    <div className="flex flex-col gap-4">
      <FactList title="General" columns={2} items={[["Code", terminal.code], ["Name", terminal.name], ["Outlet", terminal.outlet], ["Status", terminal.isActive ? "Active" : "Inactive"], ["Notes", terminal.notes]]} />
      <FactList title="Inventory" columns={2} items={[
        ["Warehouse (the outlet's)", effective.warehouse], ["Selling location override", terminal.sellingLocation ?? "None"],
        ["Effective selling location", inherited(effective.sellingLocation.label, effective.sellingLocation.source)],
      ]} />
      <FactList title="Cash & Payments" columns={2} items={[
        ["Cash management", terminal.cashManagementEnabled ? "Enabled" : "Disabled"],
        ["Cash account", terminal.cashManagementEnabled ? inherited(effective.cashAccount.label, effective.cashAccount.source) : "None"],
        ["Payment methods", `${effective.paymentMethods.map((method) => method.label).join(", ") || "None"}${terminal.paymentMethods ? " (narrowed on this terminal)" : " (all the outlet accepts)"}`],
        ["Payment device", terminal.paymentDeviceRef],
      ]} />
      <FactList title="Documents" columns={2} items={[["Receipt series", terminal.receiptPrefix], ["Numbering", "Shared numbering service: unique, server-assigned, never reused on reprint"]]} />
      <FactList title="Hardware" columns={2} items={[
        ["Device label", terminal.deviceLabel], ["Receipt printer", terminal.receiptPrinter ?? "Browser print"], ["Cash drawer", terminal.cashDrawer ? "Connected" : "None"],
        ["Barcode scanning", terminal.barcodeScanning ? "Enabled" : "Off"],
      ]} />
      <ScannerSettingsPanel terminalId={terminal.id} />
    </div>
  );
}

function SessionsPanel({ terminal }: { terminal: TerminalDetail }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos-terminals", "sessions", terminal.id), queryFn: () => getTerminalSessions(terminal.id), enabled: terminal.capabilities.viewSessions });
  const finance = query.data?.some((row) => row.openingCash !== undefined) ?? false;
  return (
    <Panel title="Sessions" description="The open session first. Sessions are opened and closed under Sessions / Shifts.">
      {query.isLoading ? <LoadingState label="Loading sessions" rows={3} /> : query.isError ? <ErrorBanner message={errorMessage(query.error)} /> : (
        <LinesTable columns={["Session", "Business date", "Cashier", "Opened", "Closed", ...(finance ? [{ label: "Opening cash", numeric: true }, { label: "Difference", numeric: true }] : []), "Status"]}
          empty={query.data?.length ? undefined : "No sessions yet."}>
          {(query.data ?? []).map((row) => (
            <tr key={row.id}>
              <Cell><Link className="font-medium text-brand hover:underline" href={`/pos/shifts/${row.id}`}>{row.number}</Link></Cell>
              <Cell>{row.businessDate}</Cell>
              <Cell>{row.cashier}</Cell>
              <Cell>{row.openedAt ? formatDateTime(row.openedAt) : null}</Cell>
              <Cell>{row.closedAt ? formatDateTime(row.closedAt) : null}</Cell>
              {finance && <Cell numeric>{row.openingCash === undefined ? null : money(row.openingCash, terminal.effective.currencyCode ?? "INR")}</Cell>}
              {finance && <Cell numeric className={row.difference ? "text-danger" : undefined}>{row.difference === null || row.difference === undefined ? null : money(row.difference, terminal.effective.currencyCode ?? "INR")}</Cell>}
              <Cell><StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>{statusLabel(row.status)}</StatusBadge></Cell>
            </tr>
          ))}
        </LinesTable>
      )}
    </Panel>
  );
}

function TransactionsPanel({ terminal }: { terminal: TerminalDetail }) {
  const workspace = useWorkspaceContext();
  const [kind, setKind] = useState("all");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos-terminals", "transactions", terminal.id, kind),
    queryFn: () => getTerminalTransactions(terminal.id, { kind: kind === "all" ? undefined : kind }), enabled: terminal.capabilities.viewTransactions });
  return (
    <div className="flex flex-col gap-3">
      <Select aria-label="Transactions" size="compact" className="w-48" selectedKey={kind} onSelectionChange={(key) => setKind(String(key))}
        options={[{ value: "all", label: "Sales and returns" }, { value: "sales", label: "Sales" }, { value: "returns", label: "Returns" }, { value: "voided", label: "Voided" }]} />
      {query.isLoading ? <LoadingState label="Loading transactions" rows={3} /> : query.isError ? <ErrorBanner message={errorMessage(query.error)} /> : (
        <LinesTable columns={["Receipt", "Date / time", "Cashier", "Customer", { label: "Items", numeric: true }, { label: "Total", numeric: true }, "Payment", "Status"]}
          empty={query.data?.length ? undefined : "No transactions yet."}>
          {(query.data ?? []).map((row) => (
            <tr key={`${row.kind}-${row.id}`}>
              <Cell>{row.kind === "sale" ? <Link className="font-medium text-brand hover:underline" href={`/pos/transactions/${row.id}`}>{row.number}</Link>
                : <span className="font-medium">{row.number} <span className="text-xs text-text-muted">return</span></span>}</Cell>
              <Cell>{row.at ? formatDateTime(row.at) : null}</Cell>
              <Cell>{row.cashier}</Cell>
              <Cell>{row.customer}</Cell>
              <Cell numeric>{row.items}</Cell>
              <Cell numeric>{money(row.amount, terminal.effective.currencyCode ?? "INR")}</Cell>
              <Cell>{row.payment}</Cell>
              <Cell><StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>{statusLabel(row.status)}</StatusBadge></Cell>
            </tr>
          ))}
        </LinesTable>
      )}
    </div>
  );
}

function HistoryPanel({ terminal }: { terminal: TerminalDetail }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos-terminals", "history", terminal.id), queryFn: () => getTerminalHistory(terminal.id) });
  if (query.isLoading) return <LoadingState label="Loading history" rows={3} />;
  if (query.isError) return <ErrorBanner message={errorMessage(query.error)} />;
  return <HistoryList title={null} empty="No changes recorded yet." entries={(query.data ?? []).map((row) => ({
    summary: row.summary, at: row.createdAt, actor: row.actorName, detail: row.reason ? <span className="text-sm text-text-secondary">Reason: {row.reason}</span> : undefined,
  }))} />;
}

// Deactivation waits for the open session, open carts and failed postings on this terminal.
function DeactivateDialog({ terminal, onClose, onDone }: { terminal: TerminalDetail; onClose: () => void; onDone: () => void }) {
  const workspace = useWorkspaceContext();
  const [reason, setReason] = useState("");
  const [blockers, setBlockers] = useState<Blocker[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const check = useQuery({ queryKey: scopedQueryKey(workspace, "pos-terminals", "status-check", terminal.id), queryFn: () => getTerminalStatusCheck(terminal.id) });
  const run = useMutation({
    mutationFn: () => setTerminalStatus(terminal.id, { status: "inactive", reason: reason.trim() || undefined }),
    onSuccess: onDone, onError: (failure) => { setBlockers(blockersOf(failure)); setError(errorMessage(failure)); },
  });
  const shown = blockers ?? check.data?.blockers ?? [];
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={`Deactivate ${terminal.code}?`}>
      <div className="flex flex-col gap-3">
        {check.isLoading ? <LoadingState label="Checking" rows={2} /> : shown.length ? (
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-medium">It cannot be deactivated yet:</p>
            <ul className="list-disc pl-5">{shown.map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}</ul>
          </div>
        ) : <p className="text-sm">No session can be opened and nothing can be sold on it once it is inactive. Its sessions and sales stay, and it can be activated again.</p>}
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
