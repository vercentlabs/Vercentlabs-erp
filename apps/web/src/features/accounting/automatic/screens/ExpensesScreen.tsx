"use client";

// Expenses: record what was spent — paid now from cash or bank, or payable later (an expense claim) — with GST when there is any. A second
// person approves it and it is posted to the accounts automatically: the expense, the input GST (waiting for confirmation when the credit is
// claimable), and cash, bank or expense claims payable. A payable expense is paid later from here; a mistake is reversed, never edited.
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import {
  Button, ComboBox, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, Select, StatusBadge, TextField,
} from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { FactList, byLine } from "@/shared/ui/record";
import { useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  amount, createExpense, errorMessage, errorStatus, expenseAction, getExpense, listExpenses, listPostingAccounts, newKey, type AccountOption, type Expense,
} from "../api/automatic-api";
import { AccountingRecorded } from "../components/AccountingRecorded";

const VIEWS = [{ id: "all", label: "All" }, { id: "SUBMITTED", label: "Awaiting approval" }, { id: "POSTED", label: "Posted" }, { id: "DRAFT", label: "Draft" },
  { id: "REJECTED", label: "Sent back" }, { id: "REVERSED", label: "Reversed" }];
export const EXPENSE_STATUS: Record<Expense["status"], { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  DRAFT: { label: "Draft", tone: "info" }, SUBMITTED: { label: "Awaiting approval", tone: "info" }, POSTED: { label: "Posted", tone: "success" },
  REJECTED: { label: "Sent back", tone: "danger" }, REVERSED: { label: "Reversed", tone: "warning" }, CANCELLED: { label: "Cancelled", tone: "neutral" },
};
const GST = { NO_GST: "No GST", GST_CLAIM_ITC: "GST — claim input tax credit", GST_NO_ITC: "GST — no credit (part of the cost)" } as const;
const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };

const useAccounts = () => {
  const workspace = useWorkspaceContext();
  return useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "posting-accounts"), queryFn: listPostingAccounts, staleTime: 60_000 });
};
const accountOptions = (accounts: AccountOption[] | undefined, test: (account: AccountOption) => boolean) =>
  (accounts ?? []).filter(test).map((account) => ({ value: account.id, label: `${account.code} · ${account.name}` }));

export function ExpensesScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [creating, setCreating] = useState(false);
  const selected = params.get("id");
  const filters = { status: view === "all" ? undefined : view, search: submitted || undefined };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "expenses", filters), queryFn: () => listExpenses(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const paged = usePagedRows(rows);
  const columns = useMemo<ColumnDef<Expense, unknown>[]>(() => [
    { id: "number", accessorKey: "number", header: "Expense", enableHiding: false, cell: ({ row }) => <span className="font-medium text-text">{row.original.number}</span> },
    { id: "date", accessorKey: "date", header: "Date", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{formatDate(row.original.date)}</span> },
    { id: "description", accessorKey: "description", header: "For", cell: ({ row }) => <span className="flex flex-col"><span>{row.original.description}</span>
      <span className="text-xs text-text-muted">{row.original.payee ?? row.original.expenseAccount.label}</span></span> },
    { id: "total", accessorKey: "total", header: "Amount", cell: ({ row }) => <span className="tabular-nums">{amount(row.original.total, row.original.currency)}</span> },
    { id: "settlement", accessorKey: "settlement", header: "Paid", cell: ({ row }) => row.original.settlement === "PAID" ? "Paid" : row.original.paidAt ? "Paid later" : "Payable" },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={EXPENSE_STATUS[row.original.status].tone}>{EXPENSE_STATUS[row.original.status].label}</StatusBadge> },
  ], []);
  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to expenses" description="Ask an administrator for access." />;
  const open = (id: string | null) => router.replace(id ? `/accounting/expenses?id=${id}` : "/accounting/expenses");
  return (
    <EnterpriseListPage
      header={{
        title: "Expenses",
        description: "Record what the business spent. Once approved, it is added to your accounts automatically — no journal entry needed.",
        primaryAction: can("accounting.payables.manage") ? <Button variant="primary" onPress={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />New expense</Button> : undefined,
      }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{ start: <SearchField aria-label="Search expenses" placeholder="Number, description or payee" className="w-full sm:w-80" value={search} onChange={setSearch} /> }}
    >
      <EnterpriseDataGrid<Expense>
        aria-label="Expenses" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (submitted || view !== "all" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading expenses" rows={8} />}
        errorContent={<ErrorState title="Could not load expenses" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No expenses yet" description="Record rent, courier, travel or any other spend; it posts to the accounts once approved." />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try another view or search." />}
        {...paged.grid}
        onRowClick={(row) => open(row.id)}
      />
      {creating && <ExpenseForm onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); open(id); }} />}
      {selected && <ExpenseDialog key={selected} id={selected} onClose={() => open(null)} />}
    </EnterpriseListPage>
  );
}

function ExpenseForm({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const [key] = useState(newKey);
  const [form, setForm] = useState({ date: today(), description: "", expenseAccountId: null as string | null, payeeName: "", supplierGstin: "", supplierInvoiceReference: "", amount: "",
    gstTreatment: "NO_GST" as keyof typeof GST, gstSupply: "INTRA_STATE", gstRate: "18", settlement: "PAID", paidFromAccountId: null as string | null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(field: K) => (value: (typeof form)[K]) => setForm((current) => ({ ...current, [field]: value }));
  const tax = form.gstTreatment === "NO_GST" ? 0 : Math.round(Number(form.amount || 0) * Number(form.gstRate || 0)) / 100;
  const save = async (submit: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const expense = await createExpense({ idempotencyKey: key, date: form.date, description: form.description.trim(), expenseAccountId: form.expenseAccountId, payeeName: form.payeeName.trim() || null,
        supplierGstin: form.supplierGstin.trim() || null, supplierInvoiceReference: form.supplierInvoiceReference.trim() || null, amount: form.amount, gstTreatment: form.gstTreatment,
        gstSupply: form.gstTreatment === "NO_GST" ? undefined : form.gstSupply, gstRate: form.gstTreatment === "NO_GST" ? undefined : form.gstRate, settlement: form.settlement,
        paidFromAccountId: form.settlement === "PAID" ? form.paidFromAccountId : null, submit });
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") });
      onCreated(expense.id);
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  const ready = form.description.trim() && form.expenseAccountId && Number(form.amount) > 0 && (form.settlement === "PAYABLE" || form.paidFromAccountId);
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title="New expense" size="lg">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="Date" type="date" value={form.date} onChange={set("date")} isRequired />
        <TextField label="What it was for" value={form.description} onChange={set("description")} maxLength={500} isRequired />
        <ComboBox label="Expense account" placeholder="Search accounts" selectedKey={form.expenseAccountId} onSelectionChange={(value) => set("expenseAccountId")(value ? String(value) : null)}
          options={accountOptions(accounts.data?.accounts, (account) => account.accountClass === "expense" || account.accountType === "fixed_asset")} isRequired />
        <TextField label="Amount before GST (₹)" inputMode="decimal" value={form.amount} onChange={set("amount")} isRequired />
        <TextField label="Paid to" value={form.payeeName} onChange={set("payeeName")} maxLength={200} />
        <Select label="GST" selectedKey={form.gstTreatment} onSelectionChange={(value) => set("gstTreatment")(String(value) as keyof typeof GST)}
          options={Object.entries(GST).map(([value, label]) => ({ value, label }))} />
        {form.gstTreatment !== "NO_GST" && (
          <>
            <Select label="Supply" selectedKey={form.gstSupply} onSelectionChange={(value) => set("gstSupply")(String(value))}
              options={[{ value: "INTRA_STATE", label: "Within the state (CGST + SGST)" }, { value: "INTER_STATE", label: "From another state (IGST)" }]} />
            <Select label="GST rate" selectedKey={form.gstRate} onSelectionChange={(value) => set("gstRate")(String(value))} options={["5", "12", "18", "28"].map((value) => ({ value, label: `${value}%` }))} />
            <TextField label="Supplier GSTIN" value={form.supplierGstin} onChange={set("supplierGstin")} maxLength={15} isRequired={form.gstTreatment === "GST_CLAIM_ITC"} />
            <TextField label="Supplier invoice number" value={form.supplierInvoiceReference} onChange={set("supplierInvoiceReference")} maxLength={100} />
          </>
        )}
        <Select label="Payment" selectedKey={form.settlement} onSelectionChange={(value) => set("settlement")(String(value))}
          options={[{ value: "PAID", label: "Already paid" }, { value: "PAYABLE", label: "To be paid later" }]} />
        {form.settlement === "PAID" && (
          <ComboBox label="Paid from" placeholder="Cash or bank account" selectedKey={form.paidFromAccountId} onSelectionChange={(value) => set("paidFromAccountId")(value ? String(value) : null)}
            options={accountOptions(accounts.data?.accounts, (account) => account.accountType === "cash" || account.accountType === "bank")} isRequired />
        )}
      </div>
      <p className="text-sm text-text-secondary">Total {amount(Number(form.amount || 0) + tax)}{tax ? ` (GST ${amount(tax)})` : ""}</p>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" isLoading={busy} isDisabled={!ready} onPress={() => save(false)}>Save draft</Button>
        <Button variant="primary" isLoading={busy} isDisabled={!ready} onPress={() => save(true)}>Submit for approval</Button>
      </div>
    </Dialog>
  );
}

function ExpenseDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "expense", id), queryFn: () => getExpense(id), retry: false });
  const [reason, setReason] = useState("");
  const [paidFrom, setPaidFrom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const expense = query.data;
  const run = async (action: Parameters<typeof expenseAction>[1], input: Record<string, unknown> = {}) => {
    setBusy(true);
    setError(null);
    try { await expenseAction(id, action, input); setReason(""); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") }); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={expense ? `Expense ${expense.number}` : "Expense"} size="lg">
      {!expense ? (query.isError ? <Notice tone="danger">{errorMessage(query.error)}</Notice> : <LoadingState label="Loading the expense" rows={5} />) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2"><StatusBadge tone={EXPENSE_STATUS[expense.status].tone}>{EXPENSE_STATUS[expense.status].label}</StatusBadge>
            <span className="text-sm text-text-secondary">{expense.description}</span></div>
          {expense.rejectionReason && expense.status === "REJECTED" && <Notice tone="warning">Sent back: {expense.rejectionReason}</Notice>}
          <FactList columns={2} items={[
            ["Date", formatDate(expense.date)], ["Expense account", expense.expenseAccount.label], ["Paid to", expense.payee ?? "—"],
            ["Amount", amount(expense.amount, expense.currency)], ["GST", expense.gstTreatment === "NO_GST" ? "None" : `${amount(expense.taxAmount, expense.currency)} at ${Number(expense.gstRate)}% (${expense.gstTreatment === "GST_CLAIM_ITC" ? "credit claimed" : "no credit"})`],
            ["Total", amount(expense.total, expense.currency)], ["Payment", expense.settlement === "PAID" ? `Paid from ${expense.paidFrom?.label ?? ""}` : expense.paidAt ? `Paid from ${expense.paidFrom?.label ?? ""}` : "To be paid"],
            ["Supplier GSTIN", expense.supplierGstin ?? "—"], ["Submitted", byLine(expense.submittedAt, expense.submittedBy) ?? "—"], ["Approved", byLine(expense.approvedAt, expense.approvedBy) ?? "—"],
          ]} />
          <AccountingRecorded sourceType="expense,expense_payment" sourceId={expense.journalEntryId ? expense.id : null} noun="expense" />
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <div className="flex flex-wrap gap-2">
              {["DRAFT", "REJECTED"].includes(expense.status) && can("accounting.payables.manage") && <Button variant="primary" isLoading={busy} onPress={() => run("submit")}>Submit for approval</Button>}
              {expense.status === "SUBMITTED" && expense.canApprove && <Button variant="primary" isLoading={busy} onPress={() => run("approve")}>Approve and post</Button>}
              {expense.status === "SUBMITTED" && !expense.canApprove && <span className="text-sm text-text-muted">Waiting for someone else to approve it.</span>}
              {["DRAFT", "REJECTED", "SUBMITTED"].includes(expense.status) && can("accounting.payables.manage") && <Button variant="secondary" isLoading={busy} onPress={() => run("cancel")}>Cancel</Button>}
            </div>
            {expense.status === "POSTED" && expense.settlement === "PAYABLE" && !expense.paidAt && can("accounting.payments.manage") && (
              <div className="flex flex-wrap items-end gap-2">
                <ComboBox label="Pay from" size="compact" className="sm:w-72" placeholder="Cash or bank account" selectedKey={paidFrom} onSelectionChange={(value) => setPaidFrom(value ? String(value) : null)}
                  options={accountOptions(accounts.data?.accounts, (account) => account.accountType === "cash" || account.accountType === "bank")} />
                <Button size="compact" variant="primary" isLoading={busy} isDisabled={!paidFrom} onPress={() => run("pay", { paidFromAccountId: paidFrom })}>Record payment</Button>
              </div>
            )}
            {(expense.status === "SUBMITTED" && expense.canApprove) || (expense.status === "POSTED" && can("accounting.payables.approve")) ? (
              <div className="flex flex-wrap items-end gap-2">
                <TextField label="Reason" size="compact" value={reason} onChange={setReason} maxLength={500} className="sm:min-w-[18rem]" />
                {expense.status === "SUBMITTED"
                  ? <Button size="compact" variant="secondary" isLoading={busy} isDisabled={reason.trim().length < 3} onPress={() => run("reject", { reason: reason.trim() })}>Send back</Button>
                  : <Button size="compact" variant="secondary" isLoading={busy} isDisabled={reason.trim().length < 3} onPress={() => run("reverse", { reason: reason.trim() })}>Reverse</Button>}
              </div>
            ) : null}
          </div>
          {error && <Notice tone="danger">{error}</Notice>}
        </div>
      )}
    </Dialog>
  );
}
