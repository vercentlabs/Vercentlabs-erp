"use client";

// Expense categories: the company's standard list of what it spends on, each mapped to the expense account it posts to, with the GST rate
// usually charged and the receipt rule (needed or not, and up to what amount none is). Procurement's direct supplier bills use the same
// list. A category with expenses is never deleted — it is switched off.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Breadcrumb, Button, Checkbox, ComboBox, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, PermissionState, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { createCategory, errorMessage, errorStatus, inr, listCategories, updateCategory, type ExpenseCategory } from "../api/expenses-api";

const VIEWS = [{ id: "active", label: "In use" }, { id: "inactive", label: "Switched off" }, { id: "all", label: "All" }];
const RATES = ["varies", "0", "5", "12", "18", "28"];

export function ExpenseCategoriesScreen() {
  const workspace = useWorkspaceContext();
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "expense-categories"), queryFn: () => listCategories(true) });
  const [view, setView] = useState("active");
  const rows = useMemo(() => (list.data?.categories ?? []).filter((entry) => view === "all" || entry.status === view), [list.data, view]);
  const paged = usePagedRows(rows);
  const [editing, setEditing] = useState<ExpenseCategory | "new" | null>(null);
  const mayManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("accounting.settings.manage");
  const columns: ColumnDef<ExpenseCategory, unknown>[] = [
    { id: "name", accessorKey: "name", header: "Category", enableHiding: false, cell: ({ row }) => (
      <span className="flex flex-col"><span className="font-medium text-text">{row.original.name}</span>{row.original.description && <span className="text-xs text-text-muted">{row.original.description}</span>}</span>) },
    { id: "account", header: "Posts to", cell: ({ row }) => <span className={row.original.account.active ? "" : "text-danger"}>{row.original.account.label}{row.original.account.active ? "" : " (disabled)"}</span> },
    { id: "gst", header: "Usual GST", cell: ({ row }) => row.original.defaultGstRate === null ? <span className="text-text-muted">Varies</span> : `${row.original.defaultGstRate}%` },
    { id: "receipt", header: "Receipt", cell: ({ row }) => !row.original.receiptRequired ? "Not needed" : row.original.receiptThreshold > 0 ? `Above ${inr(row.original.receiptThreshold)}` : "Always" },
    { id: "spent", accessorKey: "spentThisMonth", header: "This month", cell: ({ row }) => <span className="tabular-nums">{inr(row.original.spentThisMonth)}</span> },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={row.original.status === "active" ? "success" : "neutral"}>{row.original.status === "active" ? "In use" : "Off"}</StatusBadge> },
  ];
  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage
      header={{
        breadcrumbs: [<Breadcrumb key="list" href="/accounting/expenses">Expenses</Breadcrumb>, <Breadcrumb key="this" isCurrent>Categories</Breadcrumb>],
        title: "Expense Categories",
        description: "How the company classifies what it spends. Each category posts to its expense account; Procurement's direct bills use the same list.",
        primaryAction: mayManage ? <Button variant="primary" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New category</Button> : undefined,
      }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
    >
      <EnterpriseDataGrid<ExpenseCategory>
        aria-label="Expense categories" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
        loadingContent={<LoadingState label="Loading categories" rows={8} />}
        errorContent={<ErrorState title="Could not load categories" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title={view === "inactive" ? "No category is switched off" : "No categories"} description="Add the kinds of spending your company records." />}
        {...paged.grid}
        onRowClick={mayManage ? (row) => setEditing(row) : undefined}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.name}</span>
              <StatusBadge tone={row.status === "active" ? "success" : "neutral"}>{row.status === "active" ? "In use" : "Off"}</StatusBadge></span>
            <span className="text-xs text-text-muted">{row.account.label} · GST {row.defaultGstRate === null ? "varies" : `${row.defaultGstRate}%`}</span>
          </div>
        )}
      />
      {editing && list.data && <CategoryDialog category={editing === "new" ? null : editing} accounts={list.data.options.accounts} onClose={() => setEditing(null)} />}
    </EnterpriseListPage>
  );
}

function CategoryDialog({ category, accounts, onClose }: { category: ExpenseCategory | null; accounts: Array<{ id: string; label: string }>; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: category?.name ?? "", description: category?.description ?? "", accountId: category?.account.id ?? "",
    rate: category?.defaultGstRate === null || category?.defaultGstRate === undefined ? "varies" : String(category.defaultGstRate),
    receiptRequired: category?.receiptRequired ?? true, threshold: category ? String(category.receiptThreshold) : "0",
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const save = async (status?: "active" | "inactive") => {
    setBusy(true);
    setFailure(null);
    try {
      const input = { name: form.name.trim(), description: form.description.trim() || null, accountId: form.accountId, defaultGstRate: form.rate === "varies" ? null : Number(form.rate),
        receiptRequired: form.receiptRequired, receiptThreshold: String(Number(form.threshold || 0)) };
      if (category) await updateCategory(category.id, status ? { status } : input); else await createCategory(input);
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") });
      onClose();
    } catch (error) { setFailure(errorMessage(error)); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => !open && onClose()} title={category ? `Edit ${category.name}` : "New expense category"}
      description={category && category.expenses > 0 ? `${category.expenses} expense${category.expenses === 1 ? "" : "s"} use it. A new account applies to expenses recorded from now on.` : undefined}>
      <div className="flex flex-col gap-3">
        {failure && <Notice>{failure}</Notice>}
        <TextField label="Name" isRequired value={form.name} onChange={set("name")} maxLength={120} placeholder="Courier and postage" />
        <TextField label="Description" value={form.description} onChange={set("description")} maxLength={300} description="Helps people choose the right category." />
        <ComboBox label="Posts to" isRequired placeholder="An expense account" selectedKey={form.accountId || null} onSelectionChange={(key) => set("accountId")(key ? String(key) : "")}
          options={accounts.map((entry) => ({ value: entry.id, label: entry.label }))} />
        <Select label="Usual GST rate" selectedKey={form.rate} onSelectionChange={(key) => set("rate")(String(key))}
          options={RATES.map((rate) => ({ value: rate, label: rate === "varies" ? "Varies (chosen on each expense)" : `${rate}%` }))} />
        <Checkbox isSelected={form.receiptRequired} onChange={set("receiptRequired")}>A receipt is needed</Checkbox>
        {form.receiptRequired && <TextField label="No receipt needed up to (₹)" inputMode="decimal" value={form.threshold} onChange={set("threshold")} description="0: always needed. Say 200 for small auto fares." />}
        <div className="flex flex-wrap justify-between gap-2">
          <span>{category && <Button variant="ghost" isDisabled={busy} onPress={() => save(category.status === "active" ? "inactive" : "active")}>
            {category.status === "active" ? "Switch off" : "Switch on"}</Button>}</span>
          <span className="flex gap-2">
            <Button variant="secondary" onPress={onClose}>Cancel</Button>
            <Button variant="primary" isLoading={busy} isDisabled={busy || !form.name.trim() || !form.accountId || !(Number(form.threshold || 0) >= 0)} onPress={() => save()}>Save</Button>
          </span>
        </div>
      </div>
    </Dialog>
  );
}
