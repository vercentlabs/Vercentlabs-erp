"use client";

// Bank and cash transfers: money moved between the company's cash and bank accounts (a cash deposit, a withdrawal, a transfer between banks).
// Each one posts to the accounts at once; a mistake is reversed with a reason, and both entries are kept.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, ComboBox, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, PermissionState, StatusBadge, TextField } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { usePagedRows } from "@/shared/ui/list";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { amount, createTransfer, errorMessage, errorStatus, listPostingAccounts, listTransfers, newKey, reverseTransfer, type FundTransfer } from "../api/automatic-api";

const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };

export function FundTransfersScreen() {
  const workspace = useWorkspaceContext();
  const mayManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("accounting.bank.manage");
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "fund-transfers"), queryFn: listTransfers });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const paged = usePagedRows(rows);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<FundTransfer | null>(null);
  const columns = useMemo<ColumnDef<FundTransfer, unknown>[]>(() => [
    { id: "number", accessorKey: "number", header: "Transfer", cell: ({ row }) => <span className="font-medium text-text">{row.original.number}</span> },
    { id: "date", accessorKey: "date", header: "Date", cell: ({ row }) => formatDate(row.original.date) },
    { id: "from", header: "From", cell: ({ row }) => row.original.from.label },
    { id: "to", header: "To", cell: ({ row }) => row.original.to.label },
    { id: "amount", accessorKey: "amount", header: "Amount", cell: ({ row }) => <span className="tabular-nums">{amount(row.original.amount, row.original.currency)}</span> },
    { id: "journal", header: "Journal", cell: ({ row }) => row.original.journalEntryId
      ? <Link className="text-brand underline" href={`/accounting/journals/${row.original.journalEntryId}`} onClick={(event) => event.stopPropagation()}>{row.original.journalNumber}</Link> : "—" },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={row.original.status === "POSTED" ? "success" : "warning"}>{row.original.status === "POSTED" ? "Posted" : "Reversed"}</StatusBadge> },
  ], []);
  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage header={{
      title: "Bank & Cash Transfers", description: "Money moved between your cash and bank accounts. Each transfer is recorded in the accounts as soon as it is saved.",
      primaryAction: mayManage ? <Button variant="primary" onPress={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />New transfer</Button> : undefined,
    }}>
      <EnterpriseDataGrid<FundTransfer>
        aria-label="Transfers" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
        loadingContent={<LoadingState label="Loading transfers" rows={6} />}
        errorContent={<ErrorState title="Could not load transfers" description={errorMessage(list.error)} />}
        emptyContent={<EmptyState title="No transfers yet" description="Record a cash deposit, a withdrawal or a transfer between bank accounts." />}
        {...paged.grid}
        onRowClick={(row) => setSelected(row)}
      />
      {creating && <TransferForm onClose={() => setCreating(false)} />}
      {selected && <TransferDialog transfer={selected} mayManage={mayManage} onClose={() => setSelected(null)} />}
    </EnterpriseListPage>
  );
}

function TransferForm({ onClose }: { onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "posting-accounts"), queryFn: listPostingAccounts, staleTime: 60_000 });
  const [key] = useState(newKey);
  const [form, setForm] = useState({ date: today(), fromAccountId: null as string | null, toAccountId: null as string | null, amount: "", reference: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = (accounts.data?.accounts ?? []).filter((account) => account.accountType === "cash" || account.accountType === "bank").map((account) => ({ value: account.id, label: `${account.code} · ${account.name}` }));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await createTransfer({ idempotencyKey: key, date: form.date, fromAccountId: form.fromAccountId, toAccountId: form.toAccountId, amount: form.amount, reference: form.reference.trim() || null,
        description: form.description.trim() || null });
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") });
      onClose();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title="New transfer" size="md">
      <div className="flex flex-col gap-3">
        <TextField label="Date" type="date" value={form.date} onChange={(value) => setForm({ ...form, date: value })} />
        <ComboBox label="From" placeholder="Cash or bank account" selectedKey={form.fromAccountId} onSelectionChange={(value) => setForm({ ...form, fromAccountId: value ? String(value) : null })} options={options} />
        <ComboBox label="To" placeholder="Cash or bank account" selectedKey={form.toAccountId} onSelectionChange={(value) => setForm({ ...form, toAccountId: value ? String(value) : null })} options={options} />
        <TextField label="Amount (₹)" inputMode="decimal" value={form.amount} onChange={(value) => setForm({ ...form, amount: value })} />
        <TextField label="Reference" description="Deposit slip, UTR or cheque number" value={form.reference} onChange={(value) => setForm({ ...form, reference: value })} maxLength={200} />
        <TextField label="Note" value={form.description} onChange={(value) => setForm({ ...form, description: value })} maxLength={500} />
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end"><Button variant="primary" isLoading={busy} isDisabled={!form.fromAccountId || !form.toAccountId || !(Number(form.amount) > 0)} onPress={save}>Record transfer</Button></div>
      </div>
    </Dialog>
  );
}

function TransferDialog({ transfer, mayManage, onClose }: { transfer: FundTransfer; mayManage: boolean; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reverse = async () => {
    setBusy(true);
    setError(null);
    try { await reverseTransfer(transfer.id, reason.trim()); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") }); onClose(); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Transfer ${transfer.number}`} size="md">
      <div className="flex flex-col gap-3 text-sm">
        <p>{formatDate(transfer.date)} · {transfer.from.label} → {transfer.to.label} · {amount(transfer.amount, transfer.currency)}</p>
        {transfer.reference && <p className="text-text-secondary">Reference {transfer.reference}</p>}
        {transfer.journalEntryId && <Link className="text-brand underline" href={`/accounting/journals/${transfer.journalEntryId}`}>Journal {transfer.journalNumber}</Link>}
        {transfer.status === "REVERSED" && <Notice tone="warning">Reversed: {transfer.reversalReason}</Notice>}
        {transfer.status === "POSTED" && mayManage && (
          <div className="flex flex-wrap items-end gap-2">
            <TextField label="Reason to reverse" size="compact" value={reason} onChange={setReason} maxLength={500} />
            <Button size="compact" variant="secondary" isLoading={busy} isDisabled={reason.trim().length < 3} onPress={reverse}>Reverse</Button>
          </div>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Dialog>
  );
}
