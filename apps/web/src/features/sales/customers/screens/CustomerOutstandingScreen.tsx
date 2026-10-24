"use client";

// Sales › Money to collect (Sales audit M7, Sales plan Flow 4): what each customer owes and since when — not yet due, 1–30, 31–60, 61–90 and
// over 90 days past due, less the credits they hold — for the customers the person may see, the biggest first. For each: the statement,
// a WhatsApp reminder, Record payment and a promise to pay. Statements (?tab=statements) prints any customer's statement for a period and
// keeps what was said to them.
import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Button, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, NumberField, PageHeader, PermissionState, SearchField, Select, StatusBadge, TextField, buttonVariants,
} from "@vercentlabs/design-system";

import { useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { RouteTabs } from "@/shared/ui/RouteTabs";
import { TdsCertificatesTab } from "./TdsCertificatesTab";
import { Cell, LinesTable } from "@/shared/ui/record";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { SalesApiError, post, request } from "@/features/sales/shared/http";
import { calendarDate, dateTime, money } from "@/features/sales/shared/format";
import { CustomerPicker } from "@/features/sales/shared/CustomerPicker";
import { WhatsAppSendButton } from "@/features/sales/shared/WhatsAppSend";

import { getCustomerOutstanding, type CustomerOutstanding } from "../api/customers-api";

type Row = CustomerOutstanding["rows"][number];
type CollectionNote = { id: string; kind: "reminder" | "promise" | "note"; channel: string | null; promisedDate: string | null; promisedAmount: number | null; amountDue: number | null;
  note: string | null; createdAt: string; createdBy: string | null };
const amount = (value: number) => value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const figure = (value: number, danger = false) => <span className={`tabular-nums ${danger && value > 0 ? "text-danger" : ""}`}>{value ? amount(value) : "—"}</span>;
export const statementPdfUrl = (partyId: string, range: { from?: string; to?: string } = {}, inline = true) => {
  const query = new URLSearchParams(Object.entries({ ...range, ...(inline ? { disposition: "inline" } : {}) }).filter(([, value]) => value) as Array<[string, string]>);
  return `/api/documents/sales.customer_statement/${partyId}/pdf${query.size ? `?${query}` : ""}`;
};
const KIND_LABEL = { reminder: "Reminder sent", promise: "Promised to pay", note: "Note" } as const;

export function CustomerOutstandingScreen() {
  const params = useSearchParams();
  const pathname = usePathname();
  const requested = params.get("tab");
  const tab = requested === "statements" || requested === "promises" || requested === "tds" ? requested : "due";
  // Money to collect: one item in the sidebar, three tabs.
  const tabs = [{ id: "due", label: "Due & overdue" }, { id: "statements", label: "Statements" }, { id: "promises", label: "Promises to pay" }, { id: "tds", label: "TDS certificates" }];
  return (
    <div className="flex flex-col gap-4">
      <RouteTabs label="Money to collect" base={pathname} tabs={tabs} current={tab} />
      {tab === "statements" ? <StatementsTab initialCustomer={params.get("customer")} /> : tab === "promises" ? <PromisesTab /> : tab === "tds" ? <TdsCertificatesTab /> : <AgeingTab />}
    </div>
  );
}

function AgeingTab() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [asOf, setAsOf] = useState("");
  const [promise, setPromise] = useState<Row | null>(null);
  const canRecord = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("sales.invoice.record_payment");
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "customer-outstanding", submitted, asOf),
    queryFn: () => getCustomerOutstanding({ search: submitted || undefined, asOf: asOf || undefined }),
    placeholderData: (previous) => previous,
  });
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "net", desc: true }] });
  const columns = useMemo<ColumnDef<Row, unknown>[]>(() => [
    { id: "name", accessorKey: "name", header: "Customer", cell: ({ row }) => (
      <span className="flex flex-col"><span className="font-medium text-text">{row.original.name}</span>{row.original.code && <span className="text-xs text-text-muted">{row.original.code}</span>}</span>
    ) },
    { id: "notDue", accessorKey: "notDue", header: "Not due yet", cell: ({ row }) => figure(row.original.notDue) },
    { id: "d1_30", accessorKey: "d1_30", header: "1–30 days late", cell: ({ row }) => figure(row.original.d1_30, true) },
    { id: "d31_60", accessorKey: "d31_60", header: "31–60 days late", cell: ({ row }) => figure(row.original.d31_60, true) },
    { id: "d61_90", accessorKey: "d61_90", header: "61–90 days late", cell: ({ row }) => figure(row.original.d61_90, true) },
    { id: "over90", accessorKey: "over90", header: "Over 90 days late", cell: ({ row }) => figure(row.original.over90, true) },
    { id: "credits", accessorKey: "credits", header: "Credits", cell: ({ row }) => figure(row.original.credits) },
    { id: "net", accessorKey: "net", header: "Owes", cell: ({ row }) => <span className="font-medium tabular-nums">{amount(row.original.net)}</span> },
    { id: "promised", accessorKey: "promisedDate", header: "Promised", cell: ({ row }) => (row.original.promisedDate
      ? <span className="whitespace-nowrap">{calendarDate(row.original.promisedDate)}{row.original.promisedAmount ? ` · ${amount(row.original.promisedAmount)}` : ""}</span> : "—") },
    { id: "actions", header: "", enableSorting: false, cell: ({ row }) => (
      // Kept from opening the row (the ledger) when an action is used.
      <span className="flex flex-wrap justify-end gap-1" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} role="presentation">
        <a className={buttonVariants({ variant: "ghost", size: "compact" })} href={statementPdfUrl(row.original.partyId)} target="_blank" rel="noreferrer">Statement</a>
        {row.original.net > 0.005 && <WhatsAppSendButton kind="reminder" id={row.original.partyId} size="compact" label="Remind" onSent={() => void query.refetch()} />}
        {canRecord && row.original.net > 0.005 && <Link className={buttonVariants({ variant: "ghost", size: "compact" })} href={`/sales/payments/new?customerId=${row.original.partyId}`}>Record payment</Link>}
        <Button variant="ghost" size="compact" onPress={() => setPromise(row.original)}>Promise</Button>
      </span>
    ) },
  ], [canRecord, query]);

  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to customer balances" description="Ask an administrator for the View customer financials permission." />;
  const data = query.data;
  return (
    <>
      <EnterpriseListPage
        header={{
          title: "Money to collect",
          description: data
            ? `What customers owe as of ${calendarDate(data.asOf)}, in ${data.currencyCode}: ${amount(data.totals.net ?? 0)} in all, ${amount((data.totals.d1_30 ?? 0) + (data.totals.d31_60 ?? 0) + (data.totals.d61_90 ?? 0) + (data.totals.over90 ?? 0))} past due.`
            : "What customers owe, and since when.",
          primaryAction: canRecord ? <Link className={buttonVariants({ variant: "primary" })} href="/sales/payments/new">New payment</Link> : undefined,
        }}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search customers" placeholder="Search customer" className="w-full sm:w-80" value={search} onChange={setSearch} />
              <TextField aria-label="As of" type="date" value={asOf} onChange={setAsOf} />
            </>
          ),
        }}
      >
        <EnterpriseDataGrid<Row>
          aria-label="What each customer owes"
          columns={columns}
          data={paged.pageRows}
          getRowId={(row) => row.partyId}
          state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (submitted ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading what customers owe" rows={6} />}
          errorContent={<ErrorState title="Could not load what customers owe" action={{ label: "Try again", onPress: () => void query.refetch() }} />}
          emptyContent={<EmptyState title="Nothing to collect" description="Every final invoice is paid." />}
          noResultsContent={<NoResultsState title="No customer matches" description="Try another search." />}
          {...paged.grid}
          onRowClick={(row) => router.push(`/sales/customers/${row.partyId}?tab=ledger`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.name}</span><span className="tabular-nums">{amount(row.net)}</span></span>
              <span className="text-xs text-text-muted">{[row.oldestDaysPastDue ? `Oldest overdue ${row.oldestDaysPastDue} days` : "Nothing overdue",
                row.promisedDate && `promised ${calendarDate(row.promisedDate)}`].filter(Boolean).join(" · ")}</span>
            </div>
          )}
        />
      </EnterpriseListPage>
      {promise && <PromiseDialog customer={{ id: promise.partyId, name: promise.name }} owes={promise.net} onClose={() => setPromise(null)} onDone={() => { setPromise(null); void query.refetch(); }} />}
    </>
  );
}

// The promises to pay customers made, the earliest first: missed ones stand out so the next call is made. Only customers who still owe.
function PromisesTab() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [promise, setPromise] = useState<Row | null>(null);
  const canRecord = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("sales.invoice.record_payment");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "customer-outstanding", "", ""), queryFn: () => getCustomerOutstanding({}) });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const rows = useMemo(() => (query.data?.rows ?? []).filter((row) => row.promisedDate && row.net > 0.005), [query.data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "promisedDate", desc: false }] });
  const columns = useMemo<ColumnDef<Row, unknown>[]>(() => [
    { id: "name", accessorKey: "name", header: "Customer", cell: ({ row }) => <span className="font-medium text-text">{row.original.name}</span> },
    { id: "promisedDate", accessorKey: "promisedDate", header: "Will pay by", cell: ({ row }) => <span className="whitespace-nowrap">{calendarDate(row.original.promisedDate ?? "")}</span> },
    { id: "state", header: "", enableSorting: false, cell: ({ row }) => <PromiseState date={row.original.promisedDate ?? ""} today={today} /> },
    { id: "promisedAmount", accessorKey: "promisedAmount", header: "Promised", cell: ({ row }) => figure(row.original.promisedAmount ?? 0) },
    { id: "net", accessorKey: "net", header: "Owes", cell: ({ row }) => <span className="font-medium tabular-nums">{amount(row.original.net)}</span> },
    { id: "actions", header: "", enableSorting: false, cell: ({ row }) => (
      <span className="flex flex-wrap justify-end gap-1" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} role="presentation">
        <WhatsAppSendButton kind="reminder" id={row.original.partyId} size="compact" label="Remind" onSent={() => void query.refetch()} />
        {canRecord && <Link className={buttonVariants({ variant: "ghost", size: "compact" })} href={`/sales/payments/new?customerId=${row.original.partyId}`}>Record payment</Link>}
        <Button variant="ghost" size="compact" onPress={() => setPromise(row.original)}>New promise</Button>
      </span>
    ) },
  ], [canRecord, query, today]);
  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to customer balances" description="Ask an administrator for the View customer financials permission." />;
  const missed = rows.filter((row) => (row.promisedDate ?? "") < today).length;
  return (
    <>
      <EnterpriseListPage header={{ title: "Promises to pay", description: rows.length
        ? `${rows.length} ${rows.length === 1 ? "customer has" : "customers have"} promised to pay${missed ? `; ${missed} missed the date` : ""}.`
        : "Dates customers promised to pay by." }}>
        <EnterpriseDataGrid<Row>
          aria-label="Promises to pay"
          columns={columns}
          data={paged.pageRows}
          getRowId={(row) => row.partyId}
          state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
          loadingContent={<LoadingState label="Loading promises" rows={4} />}
          errorContent={<ErrorState title="Could not load promises" action={{ label: "Try again", onPress: () => void query.refetch() }} />}
          emptyContent={<EmptyState title="No promises to pay" description="Record one from Due & overdue when a customer gives a date." />}
          {...paged.grid}
          onRowClick={(row) => router.push(`/sales/customers/${row.partyId}?tab=ledger`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.name}</span><PromiseState date={row.promisedDate ?? ""} today={today} /></span>
              <span className="text-xs text-text-muted">{`Will pay by ${calendarDate(row.promisedDate ?? "")}${row.promisedAmount ? ` · ${amount(row.promisedAmount)}` : ""} · owes ${amount(row.net)}`}</span>
            </div>
          )}
        />
      </EnterpriseListPage>
      {promise && <PromiseDialog customer={{ id: promise.partyId, name: promise.name }} owes={promise.net} onClose={() => setPromise(null)} onDone={() => { setPromise(null); void query.refetch(); }} />}
    </>
  );
}

function PromiseState({ date, today }: { date: string; today: string }) {
  if (date < today) return <StatusBadge tone="danger">Missed</StatusBadge>;
  if (date === today) return <StatusBadge tone="warning">Due today</StatusBadge>;
  return <StatusBadge tone="neutral">Coming</StatusBadge>;
}

export function PromiseDialog({ customer, owes, onClose, onDone }: { customer: { id: string; name: string }; owes?: number; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<"promise" | "note">("promise");
  const [date, setDate] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()));
  const [value, setValue] = useState<number>(owes && owes > 0 ? owes : Number.NaN);
  const [channel, setChannel] = useState("call");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => post(`/customers/${customer.id}/collection-notes`, { kind, channel, note: note.trim() || null,
      ...(kind === "promise" ? { promisedDate: date, promisedAmount: Number.isFinite(value) && value > 0 ? value : null } : {}) }),
    onSuccess: onDone,
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`${customer.name}: promise to pay or note`} size="md"
      description="Kept on the customer, so whoever calls next knows what was agreed.">
      <div className="flex flex-col gap-4">
        {save.isError && <Notice tone="danger">{(save.error as Error).message}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="What" selectedKey={kind} onSelectionChange={(key) => setKind(key === "note" ? "note" : "promise")}
            options={[{ value: "promise", label: "Promise to pay" }, { value: "note", label: "Note" }]} />
          <Select label="Spoke by" selectedKey={channel} onSelectionChange={(key) => setChannel(String(key))}
            options={[{ value: "call", label: "Phone call" }, { value: "visit", label: "Visit" }, { value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "Email" }]} />
          {kind === "promise" && <TextField label="Will pay by" type="date" isRequired value={date} onChange={setDate} />}
          {kind === "promise" && <NumberField label="Amount promised" value={value} onChange={setValue} minValue={0} step={0.01} />}
          <TextField className="sm:col-span-2" label="Note" isRequired={kind === "note"} value={note} onChange={setNote} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={(kind === "promise" && !date) || (kind === "note" && !note.trim()) || save.isPending} onPress={() => save.mutate()}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}

function StatementsTab({ initialCustomer }: { initialCustomer: string | null }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(initialCustomer ? { id: initialCustomer, name: "" } : null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [adding, setAdding] = useState(false);
  const notesKey = scopedQueryKey(workspace, "sales", "collection-notes", customer?.id ?? "");
  const notes = useQuery({ queryKey: notesKey, queryFn: () => request<{ notes: CollectionNote[] }>(`/customers/${customer!.id}/collection-notes`).then((r) => r.notes), enabled: Boolean(customer) });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Customer statements" description="Print or send a customer's statement for any period." />
      <div className="grid grid-cols-1 gap-3 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-4">
        <CustomerPicker value={customer?.id ?? null} onPick={(picked) => setCustomer(picked ? { id: picked.id, name: picked.name } : null)} />
        <TextField label="From" type="date" description="Empty: the financial year so far." value={from} onChange={setFrom} />
        <TextField label="To" type="date" value={to} onChange={setTo} />
        <div className="flex flex-wrap items-end gap-2">
          {customer && (
            <>
              <a className={buttonVariants({ variant: "primary" })} href={statementPdfUrl(customer.id, { from, to })} target="_blank" rel="noreferrer">View statement</a>
              <a className={buttonVariants({ variant: "secondary" })} href={statementPdfUrl(customer.id, { from, to }, false)}>Download</a>
            </>
          )}
        </div>
      </div>
      {customer && (
        <Panel title="What was said" description="Reminders sent, promises to pay and notes, newest first."
          actions={<div className="flex gap-2"><WhatsAppSendButton kind="reminder" id={customer.id} size="compact" label="Send reminder" onSent={() => void notes.refetch()} />
            <Button size="compact" variant="secondary" onPress={() => setAdding(true)}>Promise or note</Button></div>}>
          {notes.isError ? <Notice tone="danger">{(notes.error as Error).message}</Notice> : (
            <LinesTable columns={["When", "What", "Detail", "By"]} empty={notes.isLoading ? "Loading…" : notes.data?.length ? undefined : "Nothing recorded yet."}>
              {(notes.data ?? []).map((entry) => (
                <tr key={entry.id}>
                  <Cell>{dateTime(entry.createdAt)}</Cell>
                  <Cell>{KIND_LABEL[entry.kind]}{entry.channel ? ` (${entry.channel})` : ""}</Cell>
                  <Cell>{[entry.promisedDate && `by ${calendarDate(entry.promisedDate)}`, entry.promisedAmount != null && money("INR", entry.promisedAmount),
                    entry.amountDue != null && `owed ${money("INR", entry.amountDue)}`, entry.note].filter(Boolean).join(" · ") || "—"}</Cell>
                  <Cell>{entry.createdBy ?? "—"}</Cell>
                </tr>
              ))}
            </LinesTable>
          )}
        </Panel>
      )}
      {adding && customer && <PromiseDialog customer={{ id: customer.id, name: customer.name || "Customer" }} onClose={() => setAdding(false)}
        onDone={() => { setAdding(false); void queryClient.invalidateQueries({ queryKey: notesKey }); }} />}
    </div>
  );
}
