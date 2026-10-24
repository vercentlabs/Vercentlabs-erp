"use client";

// Sales › Bill › Payments Received › Cheques (Sales report Phase 2): every cheque received — in hand, post-dated, deposited, cleared or
// bounced. Select cheques to mark them deposited or cleared; a bounced cheque reverses its receipt and can raise a draft charge.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Button, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, NumberField, PermissionState, SearchField, StatusBadge, TextArea, TextField,
} from "@vercentlabs/design-system";

import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { useDebouncedValue } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { SalesApiError, post, request } from "@/features/sales/shared/http";
import { calendarDate, money } from "@/features/sales/shared/format";

type Cheque = {
  id: string; partyId: string; customerName: string; receiptId: string | null; receiptNumber: string | null; chequeNumber: string; chequeDate: string; draweeBank: string | null;
  amount: number; currencyCode: string; status: "received" | "deposited" | "cleared" | "bounced" | "cancelled"; statusLabel: string; postDated: boolean; dueToDeposit: boolean;
  depositedOn: string | null; clearedOn: string | null; bouncedOn: string | null; bounceReason: string | null; bounceCharge: number | null; bounceDebitNoteId: string | null;
};
type Register = { cheques: Cheque[]; counts: { inHand: number; postDated: number; deposited: number; dueToDeposit: number } };
type StepResult = { results: Array<{ chequeNumber: string; done?: boolean; receiptNumber?: string; error?: string }>; done: number };

const VIEWS = [
  { id: "all", label: "All cheques" }, { id: "in_hand", label: "In hand" }, { id: "post_dated", label: "Post-dated" }, { id: "deposited", label: "Deposited" },
  { id: "cleared", label: "Cleared" }, { id: "bounced", label: "Bounced" }, { id: "cancelled", label: "Given back" },
];
const TONE = { received: "info", deposited: "warning", cleared: "success", bounced: "danger", cancelled: "neutral" } as const;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

export function ChequesScreen() {
  const workspace = useWorkspaceContext();
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const chosen = Object.keys(selected).filter((id) => selected[id]);
  const [notice, setNotice] = useState<string | null>(null);
  const [bouncing, setBouncing] = useState<Cheque | null>(null);
  const [dateFor, setDateFor] = useState<"deposit" | "clear" | null>(null);
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "cheques", view, submitted),
    queryFn: () => request<Register>(`/cheques?view=${view}${submitted ? `&q=${encodeURIComponent(submitted)}` : ""}`),
    placeholderData: (previous) => previous,
  });
  const step = useMutation({
    mutationFn: ({ action, ids, date }: { action: "deposit" | "clear"; ids: string[]; date: string }) => post<StepResult>("/cheques/actions", { action, chequeIds: ids, date }),
    onSuccess: (result, { action }) => {
      const failed = result.results.filter((row) => row.error).map((row) => `${row.chequeNumber}: ${row.error}`);
      setNotice([`${result.done} ${result.done === 1 ? "cheque" : "cheques"} marked ${action === "deposit" ? "deposited" : "cleared"}.`, ...failed].join("\n"));
      setSelected({});
      setDateFor(null);
      void query.refetch();
    },
  });
  const giveBack = useMutation({ mutationFn: (cheque: Cheque) => post(`/cheques/${cheque.id}/give-back`, {}), onSuccess: () => { setNotice("The cheque is marked as given back."); void query.refetch(); } });
  const rows = query.data?.cheques ?? [];

  const columns = useMemo<ColumnDef<Cheque, unknown>[]>(() => [
    { id: "cheque", header: "Cheque", cell: ({ row }) => (
      <span className="flex flex-col"><span className="font-medium tabular-nums">{row.original.chequeNumber}</span>
        {row.original.draweeBank && <span className="text-xs text-text-muted">{row.original.draweeBank}</span>}</span>
    ) },
    { id: "customer", header: "Customer", cell: ({ row }) => <Link className="hover:underline" href={`/sales/customers/${row.original.partyId}`}>{row.original.customerName}</Link> },
    { id: "date", header: "Cheque date", cell: ({ row }) => <span className="whitespace-nowrap">{calendarDate(row.original.chequeDate)}</span> },
    { id: "amount", header: "Amount", cell: ({ row }) => <span className="tabular-nums">{money(row.original.currencyCode, row.original.amount)}</span> },
    { id: "status", header: "Status", cell: ({ row }) => (
      <span className="flex flex-wrap items-center gap-1">
        <StatusBadge tone={TONE[row.original.status]}>{row.original.statusLabel}</StatusBadge>
        {row.original.postDated && <StatusBadge tone="neutral">Post-dated</StatusBadge>}
        {row.original.dueToDeposit && <StatusBadge tone="warning">Deposit now</StatusBadge>}
      </span>
    ) },
    { id: "receipt", header: "Receipt", cell: ({ row }) => (row.original.receiptId
      ? <Link className="text-brand hover:underline" href={`/sales/payments/${row.original.receiptId}`}>{row.original.receiptNumber}</Link>
      : <span className="text-text-muted">When it clears</span>) },
    { id: "actions", header: "", cell: ({ row }) => <ChequeActions cheque={row.original} onBounce={() => setBouncing(row.original)} onGiveBack={() => giveBack.mutate(row.original)} /> },
  ], [giveBack]);

  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to the cheque register" description="Ask an administrator for the Record payments permission." />;
  const counts = query.data?.counts;
  return (
    <>
      <EnterpriseListPage
        header={{ title: "Cheques", description: counts
          ? `${counts.inHand} in hand, ${counts.postDated} post-dated, ${counts.deposited} deposited${counts.dueToDeposit ? `; ${counts.dueToDeposit} to deposit now` : ""}.`
          : "Cheques received, deposited, cleared and bounced." }}
        savedViews={{ views: VIEWS, activeViewId: view, onSelect: (next) => { setView(next); setSelected({}); } }}
        bulkActionBar={{
          selectedCount: chosen.length,
          onClearSelection: () => setSelected({}),
          actions: (
            <>
              <Button size="compact" variant="secondary" onPress={() => setDateFor("deposit")}>Mark deposited</Button>
              <Button size="compact" variant="primary" onPress={() => setDateFor("clear")}>Mark cleared</Button>
            </>
          ),
        }}
        actionBar={{ start: <SearchField aria-label="Search cheques" placeholder="Search cheque number, customer or bank" className="w-full sm:w-80" value={search} onChange={setSearch} /> }}
      >
        {notice && <Notice tone="info" className="whitespace-pre-line">{notice}</Notice>}
        {(step.isError || giveBack.isError) && <Notice tone="danger">{((step.error ?? giveBack.error) as Error).message}</Notice>}
        <EnterpriseDataGrid<Cheque>
          aria-label="Cheques"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          enableRowSelection
          rowSelection={selected}
          onRowSelectionChange={setSelected}
          state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (submitted || view !== "all" ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading cheques" rows={6} />}
          errorContent={<ErrorState title="Could not load cheques" action={{ label: "Try again", onPress: () => void query.refetch() }} />}
          emptyContent={<EmptyState title="No cheques yet" description="A payment by cheque appears here." />}
          noResultsContent={<NoResultsState title="Nothing matches" description="Try another view or search." />}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium tabular-nums">{row.chequeNumber}</span>
                <span className="tabular-nums">{money(row.currencyCode, row.amount)}</span>
              </span>
              <span className="text-xs text-text-muted">{`${row.customerName} · dated ${calendarDate(row.chequeDate)}`}</span>
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap gap-1"><StatusBadge tone={TONE[row.status]}>{row.statusLabel}</StatusBadge>
                  {row.postDated && <StatusBadge tone="neutral">Post-dated</StatusBadge>}</span>
                <ChequeActions cheque={row} onBounce={() => setBouncing(row)} onGiveBack={() => giveBack.mutate(row)} />
              </span>
            </div>
          )}
        />
      </EnterpriseListPage>
      {dateFor && (
        <DateDialog action={dateFor} count={chosen.length} isSaving={step.isPending} onClose={() => setDateFor(null)}
          onSave={(date) => step.mutate({ action: dateFor, ids: chosen, date })} />
      )}
      {bouncing && <BounceDialog cheque={bouncing} onClose={() => setBouncing(null)} onDone={(message) => { setBouncing(null); setNotice(message); void query.refetch(); }} />}
    </>
  );
}

// Bounced, and Give back for a post-dated cheque still in hand. A menu, so each row stays one line on every screen.
function ChequeActions({ cheque, onBounce, onGiveBack }: { cheque: Cheque; onBounce: () => void; onGiveBack: () => void }) {
  const items = [
    ...(["received", "deposited", "cleared"].includes(cheque.status) ? [{ id: "bounce", label: "Bounced", danger: true, onAction: onBounce }] : []),
    ...(cheque.postDated && cheque.status === "received"
      ? [{ id: "back", label: "Give back", onAction: onGiveBack, confirm: { title: `Give back cheque ${cheque.chequeNumber}?`, description: "Nothing was recorded, so nothing is undone.", confirmLabel: "Give back" } }]
      : []),
  ];
  if (!items.length) return null;
  return <span onClick={(event) => event.stopPropagation()} role="presentation"><MoreMenu label={`Actions for cheque ${cheque.chequeNumber}`} items={items} /></span>;
}

function DateDialog({ action, count, isSaving, onClose, onSave }: { action: "deposit" | "clear"; count: number; isSaving: boolean; onClose: () => void; onSave: (date: string) => void }) {
  const [date, setDate] = useState(today());
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={action === "deposit" ? `Mark ${count} deposited` : `Mark ${count} cleared`}
      description={action === "deposit" ? "The day they were paid into the bank." : "The day the bank paid them. A post-dated cheque's receipt is made now."}>
      <div className="flex flex-col gap-4">
        <TextField label={action === "deposit" ? "Deposited on" : "Cleared on"} type="date" value={date} onChange={setDate} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          <Button variant="primary" className="w-full sm:w-auto" isLoading={isSaving} isDisabled={!date} onPress={() => onSave(date)}>{action === "deposit" ? "Mark deposited" : "Mark cleared"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

function BounceDialog({ cheque, onClose, onDone }: { cheque: Cheque; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(today());
  const [charge, setCharge] = useState<number>(Number.NaN);
  const save = useMutation({
    mutationFn: () => post<{ result: { receiptReversed: boolean; debitNoteNumber: string | null; chargeNote: string | null } }>(`/cheques/${cheque.id}/bounce`,
      { reason: reason.trim(), bouncedOn: date, charge: Number.isFinite(charge) && charge > 0 ? charge : null }),
    onSuccess: ({ result }) => onDone([
      `Cheque ${cheque.chequeNumber} is marked bounced.`, result.receiptReversed ? "Its receipt was cancelled: the bills are owed again." : null,
      result.debitNoteNumber ? `Draft debit note ${result.debitNoteNumber} holds the charge: check and finalise it.` : null, result.chargeNote,
    ].filter(Boolean).join(" ")),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Cheque ${cheque.chequeNumber} bounced`}
      description={`${cheque.customerName} · ${money(cheque.currencyCode, cheque.amount)}. The receipt is cancelled and the bills are owed again.`}>
      <div className="flex flex-col gap-4">
        {save.isError && <Notice tone="danger">{(save.error as Error).message}</Notice>}
        <TextArea label="Reason from the bank" isRequired value={reason} onChange={setReason} placeholder="For example: funds insufficient" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Returned on" type="date" value={date} onChange={setDate} />
          <NumberField label="Bounce charge (optional)" description="Raised as a draft debit note." value={charge} onChange={setCharge} minValue={0} step={1} />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          <Button variant="danger" className="w-full sm:w-auto" isLoading={save.isPending} isDisabled={reason.trim().length < 3} onPress={() => save.mutate()}>Mark bounced</Button>
        </div>
      </div>
    </Dialog>
  );
}
