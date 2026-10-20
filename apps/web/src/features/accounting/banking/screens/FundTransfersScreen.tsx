"use client";

// Bank and cash transfers: money moved between the company's own accounts (a cash deposit, a withdrawal, a transfer between banks). One
// that arrives the same day posts once. One that arrives later (a cheque deposited today, credited in two days) goes through Funds in
// transit: it is sent now and received — posted into the receiving account — when it arrives. A mistake is reversed with a reason, and
// every entry is kept.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, ComboBox, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, StatusBadge, TextField } from "@vercentlabs/design-system";

import { newKey } from "@/features/accounting/automatic/api/automatic-api";
import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { FactList } from "@/shared/ui/record";
import { usePagedRows } from "@/shared/ui/list";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { TRANSFER_STATE, createTransfer, errorMessage, errorStatus, inr, listBankAccounts, listTransfers, receiveTransfer, reverseTransfer, type FundTransfer } from "../api/banking-api";

const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };
const VIEWS = [{ id: "all", label: "All" }, { id: "IN_TRANSIT", label: "In transit" }, { id: "COMPLETED", label: "Completed" }, { id: "REVERSED", label: "Reversed" }];

export function FundTransfersScreen() {
  const workspace = useWorkspaceContext();
  const mayManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("accounting.bank.manage");
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "fund-transfers"), queryFn: listTransfers });
  const [view, setView] = useState("all");
  const rows = useMemo(() => (list.data ?? []).filter((transfer) => view === "all" || transfer.state === view), [list.data, view]);
  const paged = usePagedRows(rows);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<FundTransfer | null>(null);
  const inTransit = (list.data ?? []).filter((transfer) => transfer.state === "IN_TRANSIT");
  const columns: ColumnDef<FundTransfer, unknown>[] = [
    { id: "number", accessorKey: "number", header: "Transfer", enableHiding: false, cell: ({ row }) => <span className="font-medium text-text">{row.original.number}</span> },
    { id: "date", accessorKey: "date", header: "Sent", cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.date)}</span> },
    { id: "arrival", accessorKey: "arrivalDate", header: "Arrives", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.arrivalDate && row.original.arrivalDate !== row.original.date ? formatDate(row.original.arrivalDate) : "Same day"}</span> },
    { id: "from", header: "From", cell: ({ row }) => row.original.from.label },
    { id: "to", header: "To", cell: ({ row }) => row.original.to.label },
    { id: "amount", accessorKey: "amount", header: "Amount", cell: ({ row }) => <span className="tabular-nums">{inr(row.original.amount, row.original.currency)}</span> },
    { id: "status", accessorKey: "state", header: "Status", cell: ({ row }) => <StatusBadge tone={TRANSFER_STATE[row.original.state].tone}>{TRANSFER_STATE[row.original.state].label}</StatusBadge> },
  ];
  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage
      header={{
        title: "Bank & Cash Transfers",
        description: "Money moved between your own cash and bank accounts. One that arrives on a later day stays in transit until it is received.",
        primaryAction: mayManage ? <Button variant="primary" onPress={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />New transfer</Button> : undefined,
      }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
    >
      {inTransit.length > 0 && view === "all" && (
        <Notice tone="warning">{inTransit.length} transfer{inTransit.length === 1 ? " is" : "s are"} in transit ({inr(inTransit.reduce((sum, transfer) => sum + Number(transfer.amount), 0))}). Receive each when the money arrives.</Notice>
      )}
      <EnterpriseDataGrid<FundTransfer>
        aria-label="Transfers" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (view !== "all" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading transfers" rows={6} />}
        errorContent={<ErrorState title="Could not load transfers" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No transfers yet" description="Record a cash deposit, a withdrawal or a transfer between your bank accounts." />}
        noResultsContent={<NoResultsState title="Nothing here" description="Try another view." />}
        {...paged.grid}
        onRowClick={(row) => setSelected(row)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span>
              <StatusBadge tone={TRANSFER_STATE[row.state].tone}>{TRANSFER_STATE[row.state].label}</StatusBadge></span>
            <span className="text-xs text-text-muted">{formatDate(row.date)} · {row.from.label} → {row.to.label}</span>
            <span className="text-sm tabular-nums">{inr(row.amount, row.currency)}</span>
          </div>
        )}
      />
      {creating && <TransferForm onClose={() => setCreating(false)} />}
      {selected && <TransferDialog transfer={selected} mayManage={mayManage} onClose={() => setSelected(null)} />}
    </EnterpriseListPage>
  );
}

function TransferForm({ onClose }: { onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "bank-accounts", "active"), queryFn: () => listBankAccounts(false), staleTime: 60_000 });
  const [key] = useState(newKey);
  const [form, setForm] = useState({ date: today(), arrivalDate: "", fromAccountId: null as string | null, toAccountId: null as string | null, amount: "", reference: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = (accounts.data ?? []).map((account) => ({ value: account.ledgerAccount.id, label: `${account.name}${account.kind === "cash" ? " (cash)" : account.accountNumber ? ` · ${account.accountNumber}` : ""}` }));
  const from = (accounts.data ?? []).find((account) => account.ledgerAccount.id === form.fromAccountId);
  const later = form.arrivalDate !== "" && form.arrivalDate > form.date;
  const arrivalBad = form.arrivalDate !== "" && form.arrivalDate < form.date;
  const same = form.fromAccountId !== null && form.fromAccountId === form.toAccountId;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await createTransfer({ idempotencyKey: key, date: form.date, arrivalDate: form.arrivalDate || undefined, fromAccountId: form.fromAccountId, toAccountId: form.toAccountId, amount: form.amount,
        reference: form.reference.trim() || null, description: form.description.trim() || null });
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") });
      onClose();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title="New transfer" size="md">
      <div className="flex flex-col gap-3">
        {accounts.data && accounts.data.length < 2 && <Notice tone="info">Add at least two bank or cash accounts, under Bank &amp; cash accounts, to move money between them.</Notice>}
        <ComboBox label="From" isRequired placeholder="Cash or bank account" selectedKey={form.fromAccountId} onSelectionChange={(value) => setForm({ ...form, fromAccountId: value ? String(value) : null })} options={options}
          description={from ? `Balance ${inr(from.balance, from.currency)}` : undefined} />
        <ComboBox label="To" isRequired placeholder="Cash or bank account" selectedKey={form.toAccountId} onSelectionChange={(value) => setForm({ ...form, toAccountId: value ? String(value) : null })} options={options}
          errorMessage={same ? "Choose a different account" : undefined} />
        <TextField label="Amount (₹)" isRequired inputMode="decimal" value={form.amount} onChange={(value) => setForm({ ...form, amount: value })} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Date sent" type="date" isRequired value={form.date} onChange={(value) => setForm({ ...form, date: value })} />
          <TextField label="Date it arrives" type="date" value={form.arrivalDate} onChange={(value) => setForm({ ...form, arrivalDate: value })}
            errorMessage={arrivalBad ? "Can't arrive before it is sent" : undefined} description={later ? "Held in Funds in transit until received." : "Leave empty if it arrives the same day."} />
        </div>
        <TextField label="Reference" description="Deposit slip, UTR or cheque number" value={form.reference} onChange={(value) => setForm({ ...form, reference: value })} maxLength={200} />
        <TextField label="Note" value={form.description} onChange={(value) => setForm({ ...form, description: value })} maxLength={500} />
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || !form.fromAccountId || !form.toAccountId || same || arrivalBad || !(Number(form.amount) > 0)} onPress={save}>
            {later ? "Send (in transit)" : "Record transfer"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

function TransferDialog({ transfer, mayManage, onClose }: { transfer: FundTransfer; mayManage: boolean; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [arrived, setArrived] = useState(transfer.arrivalDate ?? today());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "receive" | "reverse">(null);
  const act = async (kind: "receive" | "reverse") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "receive") await receiveTransfer(transfer.id, arrived); else await reverseTransfer(transfer.id, reason.trim());
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") });
      onClose();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(null); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Transfer ${transfer.number}`} size="md">
      <div className="flex flex-col gap-3 text-sm">
        <span><StatusBadge tone={TRANSFER_STATE[transfer.state].tone}>{TRANSFER_STATE[transfer.state].label}</StatusBadge></span>
        <FactList items={[
          ["From", transfer.from.label], ["To", transfer.to.label], ["Amount", inr(transfer.amount, transfer.currency)], ["Sent", formatDate(transfer.date)],
          ["Arrives", transfer.arrivalDate && transfer.arrivalDate !== transfer.date ? formatDate(transfer.arrivalDate) : "Same day"],
          ["Reference", transfer.reference ?? "—"], ["Note", transfer.description ?? "—"],
          ["Entries", <span key="j" className="flex flex-wrap gap-x-3">
            {transfer.journalEntryId && <Link className="text-brand underline" href={`/accounting/journals/${transfer.journalEntryId}`}>{transfer.journalNumber ?? "Sent"}</Link>}
            {transfer.arrivalJournalEntryId && <Link className="text-brand underline" href={`/accounting/journals/${transfer.arrivalJournalEntryId}`}>Received</Link>}</span>],
        ]} />
        {transfer.state === "REVERSED" && <Notice tone="warning">Reversed: {transfer.reversalReason}</Notice>}
        {transfer.state === "IN_TRANSIT" && mayManage && (
          <div className="flex flex-wrap items-end gap-2 rounded-[var(--radius-panel)] border border-border p-3">
            <TextField label="Arrived on" type="date" size="compact" value={arrived} onChange={setArrived} />
            <Button size="compact" variant="primary" isLoading={busy === "receive"} isDisabled={Boolean(busy) || arrived < transfer.date} onPress={() => act("receive")}>Receive</Button>
          </div>
        )}
        {transfer.state !== "REVERSED" && mayManage && (
          <div className="flex flex-wrap items-end gap-2">
            <TextField label="Reason to reverse" size="compact" value={reason} onChange={setReason} maxLength={500} />
            <Button size="compact" variant="secondary" isLoading={busy === "reverse"} isDisabled={Boolean(busy) || reason.trim().length < 3} onPress={() => act("reverse")}>Reverse</Button>
          </div>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Dialog>
  );
}
