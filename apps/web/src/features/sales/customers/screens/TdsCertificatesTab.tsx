"use client";

// Money to collect › TDS certificates (Sales report Phase 3): for a financial year, each customer and quarter with the TDS recorded on
// their payments, the Form 16A certificates received and what is still missing. Overdue ones (past the 16A due date) stand out.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Button, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NumberField, PermissionState, Select, StatusBadge, TextField,
} from "@vercentlabs/design-system";

import { usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { SalesApiError, post, request } from "@/features/sales/shared/http";
import { calendarDate, money } from "@/features/sales/shared/format";

type Row = {
  partyId: string; customerName: string; pan: string | null; quarter: number; quarterLabel: string; dueOn: string; expected: number; received: number; missing: number;
  status: "received" | "partly" | "missing"; overdue: boolean; sections: string[]; certificates: Array<{ id: string; number: string; amount: number; receivedOn: string }>;
};
type Data = { financialYear: number; label: string; rows: Row[]; totals: { expected: number; received: number; missing: number }; overdue: number };
const STATUS = { received: ["success", "Received"], partly: ["warning", "Partly received"], missing: ["neutral", "Not received"] } as const;

export function TdsCertificatesTab() {
  const workspace = useWorkspaceContext();
  const [year, setYear] = useState<number | null>(null);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "tds-certificates", year ?? "current"),
    queryFn: () => request<Data>(`/tds-certificates${year ? `?financialYear=${year}` : ""}`), placeholderData: (previous) => previous });
  const [recording, setRecording] = useState<Row | null>(null);
  const data = query.data;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const paged = usePagedRows(rows, { initialSorting: [] });
  const columns = useMemo<ColumnDef<Row, unknown>[]>(() => [
    { id: "customer", header: "Customer", cell: ({ row }) => (
      <span className="flex flex-col"><span className="font-medium text-text">{row.original.customerName}</span>{row.original.pan && <span className="text-xs text-text-muted">PAN {row.original.pan}</span>}</span>
    ) },
    { id: "quarter", header: "Quarter", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.quarterLabel}</span> },
    { id: "expected", header: "TDS deducted", cell: ({ row }) => <span className="tabular-nums">{money("INR", row.original.expected)}</span> },
    { id: "received", header: "Certificates", cell: ({ row }) => (
      <span className="flex flex-col"><span className="tabular-nums">{money("INR", row.original.received)}</span>
        {row.original.certificates.map((entry) => <span key={entry.id} className="text-xs text-text-muted">{`${entry.number} · ${calendarDate(entry.receivedOn)}`}</span>)}</span>
    ) },
    { id: "status", header: "Status", cell: ({ row }) => (
      <span className="flex flex-wrap gap-1"><StatusBadge tone={STATUS[row.original.status][0]}>{STATUS[row.original.status][1]}</StatusBadge>
        {row.original.overdue && <StatusBadge tone="danger">{`Due ${calendarDate(row.original.dueOn)}`}</StatusBadge>}</span>
    ) },
    { id: "actions", header: "", cell: ({ row }) => (row.original.missing > 0
      ? <Button size="compact" variant="ghost" onPress={() => setRecording(row.original)}>Record certificate</Button> : null) },
  ], []);

  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to customer TDS" description="Ask an administrator for the View customer financials permission." />;
  const current = data?.financialYear ?? new Date().getFullYear();
  const years = [current + 1, current, current - 1, current - 2].filter((entry) => entry <= new Date().getFullYear());
  return (
    <>
      <EnterpriseListPage
        header={{ title: "TDS certificates", description: data
          ? `${data.label}: ${money("INR", data.totals.expected)} deducted by customers, ${money("INR", data.totals.missing)} still without a Form 16A${data.overdue ? `; ${data.overdue} overdue` : ""}.`
          : "The Form 16A customers send for the TDS they deduct." }}
        actionBar={{ start: <Select aria-label="Financial year" selectedKey={String(year ?? current)} onSelectionChange={(key) => setYear(Number(key))}
          options={years.map((entry) => ({ value: String(entry), label: `${entry}-${String(entry + 1).slice(2)}` }))} /> }}
      >
        <EnterpriseDataGrid<Row>
          aria-label="TDS certificates"
          columns={columns}
          data={paged.pageRows}
          getRowId={(row) => `${row.partyId}-${row.quarter}`}
          state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
          loadingContent={<LoadingState label="Loading TDS" rows={4} />}
          errorContent={<ErrorState title="Could not load TDS" action={{ label: "Try again", onPress: () => void query.refetch() }} />}
          emptyContent={<EmptyState title="No TDS this year" description="TDS a customer deducts is entered with their payment." />}
          {...paged.grid}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.customerName}</span><span className="text-xs text-text-muted">{row.quarterLabel}</span></span>
              <span className="text-xs text-text-secondary">{`Deducted ${money("INR", row.expected)} · certificates ${money("INR", row.received)}`}</span>
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap gap-1"><StatusBadge tone={STATUS[row.status][0]}>{STATUS[row.status][1]}</StatusBadge>{row.overdue && <StatusBadge tone="danger">Overdue</StatusBadge>}</span>
                {row.missing > 0 && <Button size="compact" variant="ghost" onPress={() => setRecording(row)}>Record certificate</Button>}
              </span>
            </div>
          )}
        />
      </EnterpriseListPage>
      {recording && data && <RecordDialog row={recording} financialYear={data.financialYear} onClose={() => setRecording(null)} onDone={() => { setRecording(null); void query.refetch(); }} />}
    </>
  );
}

function RecordDialog({ row, financialYear, onClose, onDone }: { row: Row; financialYear: number; onClose: () => void; onDone: () => void }) {
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState(row.missing);
  const [receivedOn, setReceivedOn] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()));
  const save = useMutation({
    mutationFn: () => post("/tds-certificates", { partyId: row.partyId, financialYear, quarter: row.quarter, certificateNumber: number.trim(), amount, receivedOn, section: row.sections[0] }),
    onSuccess: onDone,
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Form 16A from ${row.customerName}`} description={`${row.quarterLabel}: ${money("INR", row.missing)} still to be certified.`}>
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (number.trim() && amount > 0) save.mutate(); }}>
        {save.isError && <Notice tone="danger">{(save.error as Error).message}</Notice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Certificate number" isRequired autoFocus value={number} onChange={setNumber} />
          <NumberField label="TDS on the certificate" value={amount} onChange={(value) => setAmount(Number.isFinite(value) ? value : 0)} minValue={0.01} step={0.01} />
          <TextField label="Received on" type="date" value={receivedOn} onChange={setReceivedOn} />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" className="w-full sm:w-auto" isLoading={save.isPending} isDisabled={!number.trim() || !(amount > 0)}>Record certificate</Button>
        </div>
      </form>
    </Dialog>
  );
}
