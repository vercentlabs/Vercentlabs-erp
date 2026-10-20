"use client";

// Chart of Accounts (Finance MVP F1): the company's accounts as a tree — group headings and the accounts under them — with each account's
// posted balance, the sub-ledger that owns a control account, and the posting rules that use it. Accounts are added, edited, moved,
// deactivated and (only when never used) deleted here. The server is the authority on every rule; this screen explains them up front.
// Above the tree, the opening cutover check compares each control account with the open documents it summarises.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, CheckCircle2, Lock, Plus } from "lucide-react";
import {
  Button, ComboBox, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, Select, StatusBadge,
  Switch, TextField,
} from "@vercentlabs/design-system";

import { money } from "@/features/accounting/shared/format";
import { filterBarOf, useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  CASH_FLOW, CLASSES, CONTROL_TYPES, TYPES_BY_CLASS, controlCheck, createAccount, deleteAccount, errorField, errorMessage, errorStatus, listChart, setAccountStatus,
  updateAccount, type AccountClass, type ChartAccount, type ChartAccountInput, type ControlCheck,
} from "../api/foundation-api";

const VIEWS = [
  { id: "all", label: "All" }, ...CLASSES.map((entry) => ({ id: entry.code, label: entry.label })), { id: "control", label: "Control accounts" }, { id: "inactive", label: "Inactive" },
];
const CLASS_TONE: Record<AccountClass, "info" | "warning" | "neutral" | "success" | "danger"> = {
  asset: "info", liability: "warning", equity: "neutral", revenue: "success", expense: "danger",
};
// The sub-ledger that owns a control account, in one word.
const OWNER: Record<string, string> = { receivable: "Customers", payable: "Suppliers", bank: "Bank", cash: "Cash", inventory: "Stock", tax: "GST", payroll: "Payroll" };
const classLabel = (code: string) => CLASSES.find((entry) => entry.code === code)?.label ?? code;
// "12,500.00 Dr" — a balance in the account's normal direction, with the side it sits on.
const balanceText = (account: ChartAccount) => {
  if (Math.abs(account.balance) < 0.005) return "—";
  const side = (account.balance >= 0) === (account.normalBalance === "debit") ? "Dr" : "Cr";
  return `${money(Math.abs(account.balance))} ${side}`;
};

export function ChartOfAccountsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const mayManage = can("accounting.chart.manage") || can("accounting.settings.manage");
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search).toLowerCase();
  const [type, setType] = useState("all");
  const [editing, setEditing] = useState<ChartAccount | "new" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const chart = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "chart"), queryFn: listChart, retry: false });
  const checks = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "chart", "control-check"), queryFn: controlCheck, retry: false });
  const all = useMemo(() => chart.data ?? [], [chart.data]);

  // A filtered list keeps the tree: a matching account brings its group headings along, so it never appears out of context.
  const rows = useMemo(() => {
    const matches = (account: ChartAccount) => {
      if (view === "inactive" ? account.status !== "inactive" : account.status !== "active") return false;
      if (CLASSES.some((entry) => entry.code === view) && account.accountClass !== view) return false;
      if (view === "control" && !account.controlKind) return false;
      if (type !== "all" && account.accountType !== type) return false;
      if (submitted && !`${account.code} ${account.name} ${account.accountTypeLabel}`.toLowerCase().includes(submitted)) return false;
      return true;
    };
    const filtering = view !== "all" || type !== "all" || Boolean(submitted);
    const byId = new Map(all.map((account) => [account.id, account]));
    const keep = new Set<string>();
    for (const account of all) {
      if (!matches(account)) continue;
      keep.add(account.id);
      if (!filtering) continue;
      for (let parent = account.parentId ? byId.get(account.parentId) : undefined; parent; parent = parent.parentId ? byId.get(parent.parentId) : undefined) keep.add(parent.id);
    }
    return all.filter((account) => keep.has(account.id));
  }, [all, view, type, submitted]);
  const paged = usePagedRows(rows, { pageSize: 1000 });
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") });

  const columns = useMemo<ColumnDef<ChartAccount, unknown>[]>(() => [
    { id: "account", header: "Account", enableSorting: false, enableHiding: false, cell: ({ row }) => {
      const account = row.original;
      return (
        <span className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${account.depth * 1.25}rem` }}>
          <span className={`tabular-nums ${account.isGroup ? "font-semibold text-text" : "text-text-secondary"}`}>{account.code}</span>
          <span className={`truncate ${account.isGroup ? "font-semibold text-text" : "text-text"}`}>{account.name}</span>
          {account.status === "inactive" && <StatusBadge tone="neutral">Inactive</StatusBadge>}
        </span>
      );
    } },
    { id: "type", header: "Type", enableSorting: false, cell: ({ row }) => (
      <span className="text-text-secondary">{row.original.isGroup ? `Group · ${row.original.childCount} account${row.original.childCount === 1 ? "" : "s"}` : row.original.accountTypeLabel}</span>
    ) },
    { id: "usedBy", header: "Used by", enableSorting: false, cell: ({ row }) => <UsedBy account={row.original} /> },
    { id: "balance", header: "Balance", enableSorting: false, cell: ({ row }) => (
      <span className={`whitespace-nowrap tabular-nums ${row.original.isGroup ? "font-semibold" : ""}`}>{balanceText(row.original)}</span>
    ) },
    { id: "ledger", header: "", enableSorting: false, enableHiding: false, cell: ({ row }) => row.original.isGroup ? null : (
      <Link className="text-xs text-brand underline" href={`/accounting/ledger/${row.original.id}`} onClick={(event) => event.stopPropagation()}>Ledger</Link>
    ) },
  ], []);

  if (chart.isError && errorStatus(chart.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  const typeOptions = [["all", "Any type"] as [string, string], ["group", "Group heading"] as [string, string],
    ...Object.values(TYPES_BY_CLASS).flat().filter(([value], index, list) => list.findIndex(([other]) => other === value) === index)];
  const filterBar = filterBarOf([
    { id: "type", active: type !== "all", label: `Type: ${typeOptions.find(([value]) => value === type)?.[1]}`, clear: () => setType("all") },
  ], paged.resetPage);
  return (
    <>
      <EnterpriseListPage
        header={{
          title: "Chart of Accounts",
          description: "Every account the books use, grouped under headings. Control accounts belong to a sub-ledger (customers, suppliers, stock, GST, payroll) and only take postings from it.",
          primaryAction: mayManage ? <Button variant="primary" onPress={() => { setMessage(null); setEditing("new"); }}><Plus className="size-4" aria-hidden="true" />New account</Button> : undefined,
        }}
        savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search accounts" placeholder="Code or name" className="w-full sm:w-72" value={search} onChange={setSearch} />
              <Select aria-label="Account type" size="compact" selectedKey={type} onSelectionChange={(key) => setType(String(key))} options={typeOptions.map(([value, label]) => ({ value, label }))} />
            </>
          ),
        }}
        filterBar={filterBar}
      >
        <div className="flex flex-col gap-3">
          {message && <Notice tone="success">{message}</Notice>}
          {checks.data && <CutoverCheck checks={checks.data} />}
          <EnterpriseDataGrid<ChartAccount>
            aria-label="Chart of accounts" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
            state={chart.isLoading ? "loading" : chart.isError ? "error" : rows.length === 0 ? (all.length ? "no-results" : "empty") : "ready"}
            loadingContent={<LoadingState label="Loading the chart of accounts" rows={12} />}
            errorContent={<ErrorState title="Could not load the chart of accounts" description={errorMessage(chart.error)} action={{ label: "Try again", onPress: () => void chart.refetch() }} />}
            emptyContent={<EmptyState title="No accounts yet" description="The standard chart is created with the company." />}
            noResultsContent={<NoResultsState title="Nothing matches" description="Try another view, type or search." />}
            {...paged.grid}
            onRowClick={(row) => { setMessage(null); setEditing(row); }}
            renderMobileCard={(account) => (
              <div className="flex flex-col gap-1" style={{ paddingLeft: `${Math.min(account.depth, 3) * 0.75}rem` }}>
                <span className="flex items-center justify-between gap-2">
                  <span className={`min-w-0 truncate ${account.isGroup ? "font-semibold" : "font-medium"}`}>{account.code} · {account.name}</span>
                  <span className="whitespace-nowrap text-sm tabular-nums">{balanceText(account)}</span>
                </span>
                <span className="text-xs text-text-muted">{account.accountTypeLabel}{account.controlLabel ? ` · ${account.controlLabel}` : ""}{account.status === "inactive" ? " · Inactive" : ""}</span>
              </div>
            )}
          />
        </div>
      </EnterpriseListPage>
      {editing && (
        <AccountDialog account={editing === "new" ? null : editing} accounts={all} mayManage={mayManage} onClose={() => setEditing(null)}
          onDone={async (text) => { setEditing(null); setMessage(text); await refresh(); }} />
      )}
    </>
  );
}

// Opening cutover: a control account must equal the open documents it summarises, or opening balances were missed or counted twice.
function CutoverCheck({ checks }: { checks: ControlCheck[] }) {
  const relevant = checks.filter((check) => Math.abs(check.ledger) >= 0.005 || Math.abs(check.subledger) >= 0.005);
  if (!relevant.length) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {relevant.map((check) => (
        <div key={check.kind} className={`flex items-start gap-3 rounded-[var(--radius-panel)] border p-3 ${check.agrees ? "border-border bg-surface" : "border-warning-emphasis/30 bg-warning-soft"}`}>
          {check.agrees ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />}
          <div className="flex min-w-0 flex-col gap-0.5 text-sm">
            <span className="font-medium text-text">{check.label} {check.agrees ? "agree" : "differ"}</span>
            <span className="text-xs text-text-secondary tabular-nums">Ledger {money(check.ledger)} · {check.subledgerLabel} {money(check.subledger)}</span>
            {!check.agrees && <span className="text-xs text-text-muted">Difference {money(check.difference)}. Check opening balances: a balance entered both as an opening journal and as opening documents is counted twice.</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function AccountDialog({ account, accounts, mayManage, onClose, onDone }: {
  account: ChartAccount | null; accounts: ChartAccount[]; mayManage: boolean; onClose: () => void; onDone: (text: string) => Promise<void>;
}) {
  const isNew = account === null;
  const [accountClass, setAccountClass] = useState<AccountClass>(account?.accountClass ?? "expense");
  const [isGroup, setIsGroup] = useState(account?.isGroup ?? false);
  const [accountType, setAccountType] = useState(account?.isGroup ? "" : account?.accountType ?? "expense");
  const [code, setCode] = useState(account?.code ?? "");
  const [name, setName] = useState(account?.name ?? "");
  const [parentId, setParentId] = useState<string | null>(account?.parentId ?? null);
  const [manual, setManual] = useState(account?.allowManualPosting ?? true);
  const [reconcile, setReconcile] = useState(account?.reconciliationRequired ?? false);
  const [cashFlow, setCashFlow] = useState<string>(account?.cashFlowCategory ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const readOnly = !mayManage;
  const used = (account?.postingCount ?? 0) > 0;
  const controlType = !isGroup && CONTROL_TYPES.has(accountType);
  const field = errorField(failure);
  const fieldError = (name: string) => (field === name ? errorMessage(failure) : undefined);

  // A group can't sit under itself or anything beneath it.
  const excluded = useMemo(() => {
    const out = new Set<string>();
    if (!account) return out;
    out.add(account.id);
    let grew = true;
    while (grew) {
      grew = false;
      for (const entry of accounts) if (entry.parentId && out.has(entry.parentId) && !out.has(entry.id)) { out.add(entry.id); grew = true; }
    }
    return out;
  }, [account, accounts]);
  const parents = accounts.filter((entry) => entry.isGroup && entry.accountClass === accountClass && entry.status === "active" && !excluded.has(entry.id));
  const types = TYPES_BY_CLASS[accountClass];

  const run = async (kind: string, work: () => Promise<string>) => {
    setBusy(kind);
    setFailure(null);
    try { await onDone(await work()); } catch (error) { setFailure(error); } finally { setBusy(null); }
  };
  const save = () => run("save", async () => {
    const input: ChartAccountInput = {
      code: code.trim(), name: name.trim(), parentId, reconciliationRequired: reconcile, cashFlowCategory: cashFlow || null,
      ...(isGroup ? {} : { accountType, allowManualPosting: controlType ? false : manual }),
    };
    if (isNew) {
      const created = await createAccount({ ...input, accountClass, isGroup });
      return `${created.code} · ${created.name} added.`;
    }
    const saved = await updateAccount(account.id, { ...input, expectedUpdatedAt: account.updatedAt });
    return `${saved.code} · ${saved.name} saved.`;
  });
  const toggleStatus = () => run("status", async () => {
    const next = account!.status === "active" ? "inactive" : "active";
    const saved = await setAccountStatus(account!.id, next);
    return `${saved.code} · ${saved.name} ${next === "inactive" ? "deactivated. Its history is kept; it takes no new postings." : "reactivated."}`;
  });
  const remove = () => run("delete", async () => {
    await deleteAccount(account!.id);
    return `${account!.code} · ${account!.name} deleted.`;
  });

  const title = isNew ? "New account" : `${account.code} · ${account.name}`;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title} size="lg"
      description={isNew ? "Add a posting account, or a group heading to organise accounts under." : `${classLabel(account.accountClass)} · ${account.accountTypeLabel}`}>
      <div className="flex flex-col gap-4 overflow-y-auto">
        {Boolean(failure) && !field && <Notice tone="danger">{errorMessage(failure)}</Notice>}
        {!isNew && (
          <div className="grid grid-cols-2 gap-2 rounded-[var(--radius-panel)] border border-border bg-surface p-3 text-sm sm:grid-cols-4">
            <Fact label="Balance" value={balanceText(account)} />
            <Fact label="Postings" value={String(account.postingCount)} />
            <Fact label="Normal side" value={account.normalBalance === "debit" ? "Debit" : "Credit"} />
            <Fact label="Status" value={account.status === "active" ? "Active" : "Inactive"} />
          </div>
        )}
        {!isNew && account.mappings.length > 0 && (
          <p className="text-xs text-text-secondary">Used by posting rules: {account.mappings.join(", ")}. Change them on <Link className="text-brand underline" href="/accounting/settings">Posting accounts</Link>.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {isNew ? (
            <Select label="Class" isRequired selectedKey={accountClass} isDisabled={readOnly}
              onSelectionChange={(key) => { const next = String(key) as AccountClass; setAccountClass(next); setAccountType(TYPES_BY_CLASS[next][0][0]); setParentId(null); }}
              options={CLASSES.map((entry) => ({ value: entry.code, label: `${entry.label} (${entry.normal} balance)` }))} />
          ) : <TextField label="Class" value={classLabel(account.accountClass)} isReadOnly />}
          {isGroup ? <TextField label="Type" value="Group heading" isReadOnly description="A heading organises accounts; it takes no postings." /> : (
            <Select label="Type" isRequired selectedKey={accountType} isDisabled={readOnly || used} errorMessage={fieldError("accountType")}
              description={used ? "Fixed: the account already has postings." : undefined}
              onSelectionChange={(key) => setAccountType(String(key))} options={types.map(([value, label]) => ({ value, label }))} />
          )}
          <TextField label="Code" isRequired value={code} onChange={(value) => setCode(value.toUpperCase())} isReadOnly={readOnly} errorMessage={fieldError("code")}
            description="Digits or capitals, e.g. 6640." />
          <TextField label="Name" isRequired value={name} onChange={setName} isReadOnly={readOnly} errorMessage={fieldError("name")} />
          <ComboBox label="Under group" placeholder="Top level" selectedKey={parentId} isDisabled={readOnly} errorMessage={fieldError("parentId")}
            onSelectionChange={(key) => setParentId(key ? String(key) : null)} options={parents.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))} />
          <Select label="Cash flow" selectedKey={cashFlow || "none"} isDisabled={readOnly} errorMessage={fieldError("cashFlowCategory")}
            onSelectionChange={(key) => setCashFlow(key === "none" ? "" : String(key))} options={[{ value: "none", label: "Not set" }, ...CASH_FLOW.map(([value, label]) => ({ value, label }))]} />
        </div>
        <div className="flex flex-col gap-2">
          {isNew && <Switch isSelected={isGroup} onChange={setIsGroup} isDisabled={readOnly}>This is a group heading</Switch>}
          {!isGroup && (
            <Switch isSelected={controlType ? false : manual} onChange={setManual} isDisabled={readOnly || controlType}>
              Allow manual journals{controlType ? " — not for a control account; its sub-ledger posts to it" : ""}
            </Switch>
          )}
          {!isGroup && <Switch isSelected={reconcile} onChange={setReconcile} isDisabled={readOnly}>Reconcile this account (bank, cash, clearing)</Switch>}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {!isNew && mayManage && (
              <Button variant="secondary" isLoading={busy === "status"} isDisabled={Boolean(busy)} onPress={toggleStatus}>{account.status === "active" ? "Deactivate" : "Reactivate"}</Button>
            )}
            {!isNew && mayManage && !used && account.childCount === 0 && account.mappings.length === 0 && (
              <Button variant="danger" isLoading={busy === "delete"} isDisabled={Boolean(busy)} onPress={remove}>Delete</Button>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={onClose}>{readOnly ? "Close" : "Cancel"}</Button>
            {mayManage && <Button variant="primary" isLoading={busy === "save"} isDisabled={Boolean(busy) || !code.trim() || !name.trim()} onPress={save}>{isNew ? "Add account" : "Save"}</Button>}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function UsedBy({ account }: { account: ChartAccount }) {
  if (account.isGroup) return null;
  const locked = account.manualPostingLocked || !account.allowManualPosting;
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap" title={account.controlLabel ? `${account.controlLabel}${locked ? "; no manual journals" : ""}` : locked ? "No manual journals" : "Manual journals allowed"}>
      {account.controlKind && <StatusBadge tone={CLASS_TONE[account.accountClass]}>{OWNER[account.controlKind] ?? account.controlKind}</StatusBadge>}
      {locked ? <span className="flex items-center gap-1 text-xs text-text-muted"><Lock className="size-3" aria-hidden="true" />{account.controlKind ? "" : "No manual journals"}</span>
        : !account.controlKind && <span className="text-xs text-text-muted">Journals</span>}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <span className="flex flex-col"><span className="text-xs text-text-muted">{label}</span><span className="font-medium tabular-nums text-text">{value}</span></span>;
}
