"use client";

// One store / outlet: Overview, Terminals, Users & Cashiers, Inventory, Products (what it sells at the counter), Payments, Tax & Documents, Sessions, Transactions, Settings and
// History. Each tab reads its own domain — stock from Inventory, tax from the GST registration, accounts from Finance, sessions and sales
// from POS — and nothing here edits a quantity, a price or a balance.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog, Button, Dialog, EmptyState, ErrorState, RecordDetailsPage, SearchField, Select, StatusBadge, Switch, Tab, TabList,
  TabPanel, Tabs, TextArea,
} from "@vercentlabs/design-system";

import { ErrorBanner, NONE, money, orNull, quantity, withNone } from "@/features/items/item-format";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable, MoreActions } from "@/shared/ui/record";
import { OutletProductsPanel } from "@/features/pos/products/components/OutletProductsPanel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  OUTLETS_BASE, blockersOf, deleteOutlet, errorCode, errorMessage, getOutlet, getOutletAccess, getOutletHistory, getOutletInventory, getOutletOptions, getOutletSessions,
  getOutletStatusCheck, getOutletTerminals, getOutletTransactions, setOutletPaymentMethods, setOutletStatus, setupIssuesOf,
  type Blocker, type OutletDetail, type OutletOptions, type PaymentMethod, type SetupIssue,
} from "../api/outlets-api";

const TABS = ["overview", "terminals", "people", "inventory", "products", "payments", "tax", "sessions", "transactions", "settings", "history"] as const;
const DAY_LABEL: Record<string, string> = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };
const STATUS_TONE: Record<string, "success" | "neutral" | "warning" | "danger" | "info"> = {
  active: "success", inactive: "neutral", maintenance: "warning", open: "success", closing: "warning", closed: "neutral", draft: "neutral", cancelled: "neutral",
  completed: "success", partially_returned: "warning", returned: "neutral", voided: "danger", pending_approval: "warning", approved: "info", rejected: "danger",
};
const statusLabel = (status: string) => status.replace(/_/g, " ").replace(/^./, (first) => first.toUpperCase());

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[var(--radius-card)] border border-border bg-surface p-3">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      {hint && <span className="text-xs text-text-muted">{hint}</span>}
    </div>
  );
}

function hoursText(outlet: OutletDetail) {
  const days = Object.entries(outlet.businessHours ?? {});
  if (!days.length) return null;
  return days.map(([day, entry]) => `${DAY_LABEL[day] ?? day} ${entry?.closed ? "closed" : `${entry?.opens ?? ""}–${entry?.closes ?? ""}`}`).join(" · ");
}

export function OutletDetailScreen({ outletId, initialTab }: { outletId: string; initialTab?: string | null }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<string>(() => (initialTab && (TABS as readonly string[]).includes(initialTab) ? initialTab : "overview"));
  const [dialog, setDialog] = useState<"deactivate" | "delete" | "payments" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<SetupIssue[]>([]);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos-outlets", "one", outletId), queryFn: () => getOutlet(outletId) });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "pos-outlets", "options"), queryFn: getOutletOptions, staleTime: 60_000 });
  const refresh = (message?: string) => {
    setError(null); setMissing([]);
    if (message) setNotice(message);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos-outlets") });
  };
  const activate = useMutation({
    mutationFn: () => setOutletStatus(outletId, { status: "active" }),
    onSuccess: () => refresh("Activated. Terminals here can now open sessions and sell."),
    onError: (failure) => { setMissing(setupIssuesOf(failure)); setError(setupIssuesOf(failure).length ? null : errorMessage(failure)); },
  });
  const remove = useMutation({ mutationFn: () => deleteOutlet(outletId), onSuccess: () => { refresh(); router.push(OUTLETS_BASE); }, onError: (failure) => { setDialog(null); setError(errorMessage(failure)); } });

  if (query.isLoading) return <LoadingState label="Loading outlet" rows={6} />;
  if (query.isError) return errorCode(query.error) === "POS_OUTLET_NOT_FOUND"
    ? <EmptyState title="Outlet not found" description="It may have been deleted, or it is not one of your outlets." action={{ label: "All outlets", onPress: () => router.push(OUTLETS_BASE) }} />
    : <ErrorState title="Could not load the outlet" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const outlet = query.data!;
  const can = outlet.capabilities;
  const setup = missing.length ? missing : outlet.isActive ? [] : outlet.setup;
  const menu = [
    { id: "deactivate", label: "Deactivate", run: () => setDialog("deactivate"), show: can.status && outlet.isActive },
    { id: "delete", label: "Delete", run: () => setDialog("delete"), show: can.status },
  ];

  return (
    <>
      <RecordDetailsPage
        header={{
          title: <>{outlet.name} <span className="text-base font-normal whitespace-nowrap text-text-muted">{outlet.code}</span></>,
          status: <StatusBadge tone={outlet.isActive ? "success" : "neutral"}>{outlet.isActive ? "Active" : "Inactive"}</StatusBadge>,
          fields: [
            { label: "Type", value: outlet.typeLabel },
            { label: "Address", value: outlet.addressText || "Not set" },
            { label: "Selling warehouse", value: outlet.warehouse ?? "Not set" },
            { label: "Manager", value: outlet.managerName ?? "Not set" },
          ],
          primaryAction: can.status && !outlet.isActive
            ? <Button variant="primary" isLoading={activate.isPending} onPress={() => { setNotice(null); activate.mutate(); }}>Activate</Button> : undefined,
          secondaryActions: (
            <>
              {(can.edit || can.manageInventory || can.manageTax) && <Button variant="secondary" onPress={() => router.push(`${OUTLETS_BASE}/${outlet.id}/edit`)}>Edit</Button>}
              <MoreActions actions={menu.map((entry) => ({ ...entry, run: () => { setError(null); setNotice(null); entry.run(); } }))} />
            </>
          ),
        }}
        tabs={
          <div className="flex flex-col gap-3">
            <ErrorBanner message={error} />
            {notice && <Notice tone="success">{notice}</Notice>}
            {setup.length > 0 && (
              <Notice tone={missing.length ? "danger" : "warning"}>
                <span className="font-medium">{missing.length ? "This outlet cannot be activated yet." : "Inactive until its setup is complete."}</span>
                <ul className="mt-1 list-disc pl-5">{setup.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul>
              </Notice>
            )}
            {!outlet.warehouseActive && <Notice tone="warning">The selling warehouse {outlet.warehouse} is inactive. Choose an active one before selling here.</Notice>}
          </div>
        }
      >
        <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
          <TabList aria-label="Outlet sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="terminals">Terminals</Tab>
            <Tab id="people">Users &amp; Cashiers</Tab>
            <Tab id="inventory">Inventory</Tab>
            <Tab id="products">Products</Tab>
            <Tab id="payments">Payments</Tab>
            <Tab id="tax">Tax &amp; Documents</Tab>
            {can.viewSessions && <Tab id="sessions">Sessions</Tab>}
            {can.viewTransactions && <Tab id="transactions">Transactions</Tab>}
            <Tab id="settings">Settings</Tab>
            <Tab id="history">History</Tab>
          </TabList>
          <TabPanel id="overview" className="pt-3"><Overview outlet={outlet} /></TabPanel>
          <TabPanel id="terminals" className="pt-3"><TerminalsPanel outlet={outlet} /></TabPanel>
          <TabPanel id="people" className="pt-3"><PeoplePanel outlet={outlet} /></TabPanel>
          <TabPanel id="inventory" className="pt-3"><InventoryPanel outlet={outlet} /></TabPanel>
          <TabPanel id="products" className="pt-3"><OutletProductsPanel outletId={outlet.id} /></TabPanel>
          <TabPanel id="payments" className="pt-3"><PaymentsPanel outlet={outlet} onEdit={() => setDialog("payments")} /></TabPanel>
          <TabPanel id="tax" className="pt-3"><TaxPanel outlet={outlet} /></TabPanel>
          <TabPanel id="sessions" className="pt-3"><SessionsPanel outlet={outlet} /></TabPanel>
          <TabPanel id="transactions" className="pt-3"><TransactionsPanel outlet={outlet} /></TabPanel>
          <TabPanel id="settings" className="pt-3"><SettingsPanel outlet={outlet} onEdit={() => router.push(`${OUTLETS_BASE}/${outlet.id}/edit`)} /></TabPanel>
          <TabPanel id="history" className="pt-3"><HistoryPanel outlet={outlet} /></TabPanel>
        </Tabs>
      </RecordDetailsPage>

      {dialog === "deactivate" && <DeactivateDialog outlet={outlet} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh("Deactivated. Its sales, sessions and history stay."); }} />}
      {dialog === "payments" && <PaymentsDialog outlet={outlet} options={options.data} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh("Payment methods saved."); }} />}
      <AlertDialog isOpen={dialog === "delete"} onOpenChange={(open) => !open && setDialog(null)} title={`Delete ${outlet.name}?`}
        description="Only an outlet that has never had a terminal, session or sale can be deleted. Anything else is deactivated, keeping its history." confirmLabel="Delete"
        isConfirming={remove.isPending} onConfirm={() => remove.mutate()} />
    </>
  );
}

function Overview({ outlet }: { outlet: OutletDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {outlet.today && <Figure label="Today's sales" value={money(outlet.today.total, outlet.currencyCode ?? "INR")} hint={`${outlet.today.sales} sale${outlet.today.sales === 1 ? "" : "s"}`} />}
        <Figure label="Open sessions" value={String(outlet.openSessions)} />
        <Figure label="Active terminals" value={`${outlet.activeTerminals} of ${outlet.terminals}`} />
        <Figure label="Payment methods" value={String(outlet.paymentMethods.filter((method) => method.enabled).length)}
          hint={outlet.paymentMethods.filter((method) => method.enabled).map((method) => method.label).join(", ") || "None enabled"} />
      </div>
      <FactList items={[
        ["Code", outlet.code], ["Name", outlet.name], ["Type", outlet.typeLabel], ["Status", outlet.isActive ? "Active" : "Inactive"], ["Address", outlet.addressText],
        ["Time zone", outlet.timezone], ["Manager", outlet.managerName], ["Phone", outlet.phone], ["Email", outlet.email],
        ["Selling warehouse", outlet.warehouse], ["GST registration", outlet.taxRegistration ? `${outlet.taxRegistration}${outlet.gstin ? ` · ${outlet.gstin}` : ""}` : null],
        ["Default price list", outlet.priceList], ["Currency", outlet.currencyCode], ["Notes", outlet.notes],
      ]} />
    </div>
  );
}

function TerminalsPanel({ outlet }: { outlet: OutletDetail }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos-outlets", "terminals", outlet.id), queryFn: () => getOutletTerminals(outlet.id) });
  return (
    <Panel title="Terminals" description="The counters that sell at this outlet. Each inherits the outlet's warehouse, prices, tax and payment methods."
      actions={<Link className="text-sm font-medium text-brand hover:underline" href={`/pos/terminals/new?outletId=${outlet.id}`}>Add terminal</Link>}>
      {query.isLoading ? <LoadingState label="Loading terminals" rows={3} /> : query.isError ? <ErrorBanner message={errorMessage(query.error)} /> : (
        <LinesTable columns={["Terminal", "Name", "Status", "Current session", "Cashier", "Last activity"]} empty={query.data?.length ? undefined : "No terminals yet."}>
          {(query.data ?? []).map((row) => (
            <tr key={row.id}>
              <Cell><Link className="font-medium text-brand hover:underline" href={`/pos/terminals/${row.id}`}>{row.code}</Link></Cell>
              <Cell>{row.name}</Cell>
              <Cell><StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>{statusLabel(row.status)}</StatusBadge></Cell>
              <Cell>{row.currentSessionId ? <Link className="text-brand hover:underline" href={`/pos/shifts/${row.currentSessionId}`}>{row.currentSession}</Link> : null}</Cell>
              <Cell>{row.cashier}</Cell>
              <Cell>{row.lastActivity ? formatDateTime(row.lastActivity) : null}</Cell>
            </tr>
          ))}
        </LinesTable>
      )}
    </Panel>
  );
}

const yes = (value: boolean) => (value ? "Yes" : "No");
const allowed = (row: { abilities: Array<{ key: string; allowed: boolean }> }, key: string) => yes(row.abilities.find((ability) => ability.key === key)?.allowed ?? false);

// The outlet's cashiers. Access is given to a cashier under POS → Cashiers (outlet administrators work everywhere without it).
function PeoplePanel({ outlet }: { outlet: OutletDetail }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos-outlets", "access", outlet.id), queryFn: () => getOutletAccess(outlet.id) });
  return (
    <Panel title="Users & Cashiers" description="The cashiers who may work at this outlet. What each may do comes from their POS role."
      actions={<Link className="text-sm font-medium text-brand hover:underline" href={`/pos/cashiers/new?outletId=${outlet.id}`}>Add cashier</Link>}>
      {query.isLoading ? <LoadingState label="Loading cashiers" rows={3} /> : query.isError ? <ErrorBanner message={errorMessage(query.error)} /> : (
        <LinesTable columns={["Cashier", "POS role", "Can operate", "Open / close shift", "Can refund", "Now", "Status"]}
          empty={query.data?.length ? undefined : "No cashier works here yet. Only outlet administrators can operate it."}>
          {(query.data ?? []).map((row) => (
            <tr key={row.id}>
              <Cell><Link className="flex flex-col" href={`/pos/cashiers/${row.id}`}><span className="font-medium text-brand hover:underline">{row.code} · {row.name}</span><span className="text-xs text-text-muted">{row.email}</span></Link></Cell>
              <Cell>{row.posRoles.join(", ")}</Cell>
              <Cell>{yes(row.canOperate)}</Cell>
              <Cell>{allowed(row, "SESSION_OPEN_OWN") === "Yes" && allowed(row, "SESSION_CLOSE_OWN") === "Yes" ? "Yes" : "No"}</Cell>
              <Cell>{allowed(row, "REFUND_INITIATE")}</Cell>
              <Cell>{row.currentTerminal ?? null}</Cell>
              <Cell><StatusBadge tone={row.operable ? "success" : "neutral"}>{row.operable ? "Active" : "Inactive"}</StatusBadge></Cell>
            </tr>
          ))}
        </LinesTable>
      )}
    </Panel>
  );
}

function InventoryPanel({ outlet }: { outlet: OutletDetail }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos-outlets", "inventory", outlet.id), queryFn: () => getOutletInventory(outlet.id) });
  if (query.isLoading) return <LoadingState label="Loading stock" rows={3} />;
  if (query.isError) return <ErrorBanner message={errorMessage(query.error)} />;
  const inventory = query.data!;
  const base = `/inventory/warehouses/${inventory.warehouseId}`;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Figure label="On hand" value={quantity(inventory.stock.onHand)} hint={`${inventory.stock.items} item${inventory.stock.items === 1 ? "" : "s"}`} />
        <Figure label="Reserved" value={quantity(inventory.stock.reserved)} />
        <Figure label="Restricted" value={quantity(inventory.stock.restricted)} hint="Quality hold, quarantined, damaged" />
        <Figure label="Available to sell" value={quantity(inventory.stock.available)} />
        {inventory.stock.value !== undefined && <Figure label="Value" value={money(inventory.stock.value)} />}
      </div>
      <p className="text-xs text-text-muted">The selling warehouse&apos;s stock, read from Inventory. Quantities are summed across items in their base units. Nothing here is editable.</p>
      <FactList columns={2} items={[
        ["Selling warehouse", inventory.warehouse], ["Selling location", inventory.sellingLocation ?? "Warehouse default"], ["Returns location", inventory.returnsLocation ?? "Warehouse default"],
        ["Shared with", inventory.sharedWith.join(", ") || null],
      ]} />
      <div className="flex flex-wrap gap-2">
        <Link className="text-sm font-medium text-brand hover:underline" href={base}>View warehouse</Link>
        <span className="text-text-muted">·</span>
        <Link className="text-sm font-medium text-brand hover:underline" href={`${base}?tab=stock`}>On-hand inventory</Link>
        <span className="text-text-muted">·</span>
        <Link className="text-sm font-medium text-brand hover:underline" href={`${base}?tab=movements`}>Stock movements</Link>
        <span className="text-text-muted">·</span>
        <Link className="text-sm font-medium text-brand hover:underline" href={`/inventory/stock-counts/new?warehouseId=${inventory.warehouseId}`}>Start stock count</Link>
      </div>
    </div>
  );
}

function PaymentsPanel({ outlet, onEdit }: { outlet: OutletDetail; onEdit: () => void }) {
  const finance = outlet.capabilities.viewFinance;
  return (
    <Panel title="Payment methods" description="What this outlet accepts. Card, UPI, wallet and bank transfer are taken through their payment provider."
      actions={outlet.capabilities.managePayments ? <Button variant="secondary" size="compact" onPress={onEdit}>Change payment methods</Button> : undefined}>
      <LinesTable columns={["Method", "Accepted", "Provider", ...(finance ? ["Cash / clearing account"] : [])]}>
        {outlet.paymentMethods.map((method) => (
          <tr key={method.method}>
            <Cell><span className="font-medium">{method.label}</span></Cell>
            <Cell><StatusBadge tone={method.enabled ? "success" : "neutral"}>{method.enabled ? "Accepted" : "Not accepted"}</StatusBadge></Cell>
            <Cell>{method.method === "cash" ? "Cash drawer" : method.enabled ? method.providerKey : null}</Cell>
            {finance && <Cell>{method.account ?? (method.method === "cash" ? outlet.cashAccount ?? "Company default" : "Company default")}</Cell>}
          </tr>
        ))}
      </LinesTable>
      {finance && <p className="text-xs text-text-muted">Default cash account: {outlet.cashAccount ?? "Company default"}. A terminal&apos;s own cash account comes first.</p>}
    </Panel>
  );
}

function TaxPanel({ outlet }: { outlet: OutletDetail }) {
  const documents = outlet.documents;
  return (
    <div className="flex flex-col gap-4">
      <FactList title="Tax" items={[
        ["GST registration", documents.taxRegistration ?? "None"], ["GSTIN", documents.gstin], ["Legal name", documents.legalName],
        ["State code", outlet.registrationStateCode], ["Outlet state code", outlet.address.stateCode],
      ]} />
      <Panel title="Receipt numbering" description="Receipts and returns are numbered by the shared numbering service, in each terminal's own series.">
        <LinesTable columns={["Terminal", "Receipt series prefix"]} empty={documents.receiptSeries.length ? undefined : "No terminals yet."}>
          {documents.receiptSeries.map((series) => <tr key={series.terminal}><Cell>{series.terminal}</Cell><Cell><span className="tabular-nums">{series.prefix}</span></Cell></tr>)}
        </LinesTable>
      </Panel>
      <Panel title="Receipt header" description="What each receipt shows. The legal name and GSTIN come from the GST registration, never typed on the outlet.">
        <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface-muted p-4 text-center text-sm">
          <p className="font-semibold">{documents.legalName ?? documents.receiptHeader.displayName}</p>
          <p>{documents.receiptHeader.displayName}</p>
          <p className="text-text-secondary">{documents.receiptHeader.address}</p>
          {(documents.receiptHeader.phone || documents.receiptHeader.email) && <p className="text-text-secondary">{[documents.receiptHeader.phone, documents.receiptHeader.email].filter(Boolean).join(" · ")}</p>}
          {documents.gstin && <p className="text-text-secondary">GSTIN {documents.gstin}</p>}
          {documents.receiptMessage && <p className="mt-2 italic">{documents.receiptMessage}</p>}
        </div>
      </Panel>
    </div>
  );
}

function SessionsPanel({ outlet }: { outlet: OutletDetail }) {
  const workspace = useWorkspaceContext();
  const [status, setStatus] = useState(NONE);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos-outlets", "sessions", outlet.id, status), queryFn: () => getOutletSessions(outlet.id, { status: orNull(status) ?? undefined }),
    enabled: outlet.capabilities.viewSessions });
  const finance = outlet.capabilities.viewFinance;
  const cash = (value: number | null | undefined) => (value === null || value === undefined ? null : money(value, outlet.currencyCode ?? "INR"));
  return (
    <div className="flex flex-col gap-3">
      <Select aria-label="Status" size="compact" className="w-48" selectedKey={status} onSelectionChange={(key) => setStatus(String(key))}
        options={withNone(["open", "closing", "closed"].map((value) => ({ value, label: statusLabel(value) })), "Any status")} />
      {query.isLoading ? <LoadingState label="Loading sessions" rows={3} /> : query.isError ? <ErrorBanner message={errorMessage(query.error)} /> : (
        <LinesTable columns={["Session", "Terminal", "Cashier", "Business date", "Opened", "Closed", ...(finance ? [{ label: "Opening cash", numeric: true }, { label: "Closing cash", numeric: true },
          { label: "Difference", numeric: true }] : []), "Status"]} empty={query.data?.length ? undefined : "No sessions yet."}>
          {(query.data ?? []).map((row) => (
            <tr key={row.id}>
              <Cell><Link className="font-medium text-brand hover:underline" href={`/pos/shifts/${row.id}`}>{row.number}</Link></Cell>
              <Cell>{row.terminal}</Cell>
              <Cell>{row.cashier}</Cell>
              <Cell>{row.businessDate}</Cell>
              <Cell>{row.openedAt ? formatDateTime(row.openedAt) : null}</Cell>
              <Cell>{row.closedAt ? formatDateTime(row.closedAt) : null}</Cell>
              {finance && <Cell numeric>{cash(row.openingCash)}</Cell>}
              {finance && <Cell numeric>{cash(row.closingCash)}</Cell>}
              {finance && <Cell numeric className={row.difference ? "text-danger" : undefined}>{cash(row.difference)}</Cell>}
              <Cell><StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>{statusLabel(row.status)}</StatusBadge></Cell>
            </tr>
          ))}
        </LinesTable>
      )}
    </div>
  );
}

function TransactionsPanel({ outlet }: { outlet: OutletDetail }) {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos-outlets", "transactions", outlet.id, search.trim()),
    queryFn: () => getOutletTransactions(outlet.id, { search: search.trim() || undefined }), enabled: outlet.capabilities.viewTransactions, placeholderData: (previous) => previous });
  return (
    <div className="flex flex-col gap-3">
      <SearchField aria-label="Search transactions" placeholder="Search receipt, customer, cashier or terminal" className="w-full sm:w-80" value={search} onChange={setSearch} />
      {query.isLoading ? <LoadingState label="Loading transactions" rows={3} /> : query.isError ? <ErrorBanner message={errorMessage(query.error)} /> : (
        <LinesTable columns={["Receipt", "Date / time", "Terminal", "Cashier", "Customer", { label: "Amount", numeric: true }, "Payment", "Status"]}
          empty={query.data?.length ? undefined : "No sales or returns yet."}>
          {(query.data ?? []).map((row) => (
            <tr key={`${row.kind}-${row.id}`}>
              <Cell>{row.kind === "sale" ? <Link className="font-medium text-brand hover:underline" href={`/pos/transactions/${row.id}`}>{row.number}</Link>
                : <span className="font-medium">{row.number} <span className="text-xs text-text-muted">return</span></span>}</Cell>
              <Cell>{row.at ? formatDateTime(row.at) : null}</Cell>
              <Cell>{row.terminal}</Cell>
              <Cell>{row.cashier}</Cell>
              <Cell>{row.customer}</Cell>
              <Cell numeric>{money(row.amount, outlet.currencyCode ?? "INR")}</Cell>
              <Cell>{row.payment}</Cell>
              <Cell><StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>{statusLabel(row.status)}</StatusBadge></Cell>
            </tr>
          ))}
        </LinesTable>
      )}
    </div>
  );
}

function SettingsPanel({ outlet, onEdit }: { outlet: OutletDetail; onEdit: () => void }) {
  const can = outlet.capabilities;
  return (
    <Panel title="Outlet settings" description="The defaults this outlet applies to new carts and sales. Organization-wide POS policy is under POS Setup."
      actions={can.edit || can.manageInventory || can.manageTax ? <Button variant="secondary" size="compact" onPress={onEdit}>Edit</Button> : undefined}>
      <FactList columns={2} items={[
        ["Selling warehouse", outlet.warehouse], ["Selling location", outlet.sellingLocation ?? "Warehouse default"], ["Returns location", outlet.returnsLocation ?? "Warehouse default"],
        ["Default price list", outlet.priceList ?? "Company default"], ["Walk-in sales", outlet.walkIn.allowWalkInSales ? "Allowed (no customer record needed)" : "Not allowed — every sale needs a customer"],
        ...(can.viewFinance ? [["Default cash account", outlet.cashAccount ?? "Company default"] as [string, string]] : []),
        ["Business hours", hoursText(outlet)], ["Time zone", outlet.timezone],
      ]} />
    </Panel>
  );
}

function HistoryPanel({ outlet }: { outlet: OutletDetail }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos-outlets", "history", outlet.id), queryFn: () => getOutletHistory(outlet.id) });
  if (query.isLoading) return <LoadingState label="Loading history" rows={3} />;
  if (query.isError) return <ErrorBanner message={errorMessage(query.error)} />;
  return <HistoryList title={null} empty="No changes recorded yet." entries={(query.data ?? []).map((row) => ({
    summary: row.summary, at: row.createdAt, actor: row.actorName, detail: row.reason ? <span className="text-sm text-text-secondary">Reason: {row.reason}</span> : undefined,
  }))} />;
}

// Deactivation lists what stands in the way: open sessions, open carts, active terminals, unresolved reconciliations, failed postings.
function DeactivateDialog({ outlet, onClose, onDone }: { outlet: OutletDetail; onClose: () => void; onDone: () => void }) {
  const workspace = useWorkspaceContext();
  const [reason, setReason] = useState("");
  const [blockers, setBlockers] = useState<Blocker[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const check = useQuery({ queryKey: scopedQueryKey(workspace, "pos-outlets", "status-check", outlet.id), queryFn: () => getOutletStatusCheck(outlet.id) });
  const run = useMutation({
    mutationFn: () => setOutletStatus(outlet.id, { status: "inactive", reason: reason.trim() || undefined }),
    onSuccess: onDone, onError: (failure) => { setBlockers(blockersOf(failure)); setError(errorMessage(failure)); },
  });
  const shown = blockers ?? check.data?.blockers ?? [];
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Deactivate ${outlet.name}?`}>
      <div className="flex flex-col gap-3">
        {check.isLoading ? <LoadingState label="Checking" rows={2} /> : shown.length ? (
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-medium">It cannot be deactivated yet:</p>
            <ul className="list-disc pl-5">{shown.map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}</ul>
          </div>
        ) : <p className="text-sm">No session can be opened and nothing can be sold here once it is inactive. Its sales, sessions and history stay, and its warehouse keeps its stock.</p>}
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

// Which methods the outlet accepts, the provider behind each non-cash one, and (with finance access) each method's cash or clearing account.
function PaymentsDialog({ outlet, options, onClose, onDone }: { outlet: OutletDetail; options?: OutletOptions; onClose: () => void; onDone: () => void }) {
  const [methods, setMethods] = useState<PaymentMethod[]>(outlet.paymentMethods);
  const [error, setError] = useState<string | null>(null);
  const finance = outlet.capabilities.viewFinance;
  const save = useMutation({
    mutationFn: () => setOutletPaymentMethods(outlet.id, methods.map((method) => ({
      method: method.method, enabled: method.enabled, ...(method.method === "cash" ? {} : { providerKey: method.providerKey ?? "sandbox" }), ...(finance ? { accountId: method.accountId } : {}),
    }))),
    onSuccess: onDone, onError: (failure) => setError(errorMessage(failure)),
  });
  const change = (code: string, patch: Partial<PaymentMethod>) => setMethods((current) => current.map((method) => (method.method === code ? { ...method, ...patch } : method)));
  const accounts = (cash: boolean) => withNone((options?.accounts ?? []).filter((account) => (cash ? account.type === "cash" : true)).map((account) => ({ value: account.id, label: account.label })), "Company default");
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Payment methods at ${outlet.name}`} size="lg">
      <div className="flex flex-col gap-3">
        <ErrorBanner message={error} />
        {methods.map((method) => (
          <div key={method.method} className="grid grid-cols-1 items-end gap-2 rounded-[var(--radius-card)] border border-border p-3 sm:grid-cols-3">
            <Switch isSelected={method.enabled} onChange={(enabled) => change(method.method, { enabled })}>{method.label}</Switch>
            {method.method === "cash" ? <span className="text-sm text-text-muted">Taken in the cash drawer</span> : (
              <Select label="Provider" size="compact" selectedKey={method.providerKey ?? "sandbox"} isDisabled={!method.enabled}
                onSelectionChange={(key) => change(method.method, { providerKey: String(key) })} options={(options?.providers ?? ["sandbox"]).map((key) => ({ value: key, label: key }))} />
            )}
            {finance && (
              <Select label={method.method === "cash" ? "Cash account" : "Clearing account"} size="compact" selectedKey={method.accountId ?? NONE}
                onSelectionChange={(key) => change(method.method, { accountId: orNull(String(key)) })} options={accounts(method.method === "cash")} />
            )}
          </div>
        ))}
        <p className="text-xs text-text-muted">A method switched off is no longer offered at checkout here. Payment definitions and accounts belong to Finance; credentials are never stored here.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} onPress={() => { setError(null); save.mutate(); }}>Save payment methods</Button>
        </div>
      </div>
    </Dialog>
  );
}
