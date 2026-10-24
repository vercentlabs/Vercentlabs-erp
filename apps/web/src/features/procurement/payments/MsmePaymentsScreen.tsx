"use client";

// Payables › MSME Payments (Procurement plan Phase 1): bills to micro and small suppliers against their statutory deadline (MSMED Act s.15 —
// the agreed days, never more than 45, else 15, from acceptance). Unpaid past the deadline, the expense is also disallowed under s.43B(h).
// Buckets by the days left; each row opens its bill to pay it.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download } from "lucide-react";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, SearchField, Select, StatusBadge, TextField, buttonVariants } from "@vercentlabs/design-system";

import { Facts, Panel } from "@/shared/ui/Panel";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { useListState } from "@/features/procurement/shared/navigation";
import { calendarDate, money } from "@/features/procurement/shared/format";

import { gridPaging, pageFilters, usePageIndex } from "@/features/procurement/shared/paging";
import { errorMessage, getMsme1, getMsmeYearEnd, listMsmePayments, msme1CsvUrl, type MsmeRow } from "./api";

const BUCKETS = [{ key: "all", label: "All open" }, { key: "overdue", label: "Overdue" }, { key: "due_7", label: "Due in 7 days" }, { key: "due_15", label: "Due in 15 days" },
  { key: "due_45", label: "Due in 45 days" }, { key: "disputed", label: "Disputed" }];

function DaysLeft({ row }: { row: MsmeRow }) {
  if (row.disputed) return <StatusBadge tone="neutral">Disputed</StatusBadge>;
  if (row.daysLeft < 0) return <StatusBadge tone="danger">{`${-row.daysLeft} day${row.daysLeft === -1 ? "" : "s"} late`}</StatusBadge>;
  if (row.daysLeft === 0) return <StatusBadge tone="warning">Due today</StatusBadge>;
  return <StatusBadge tone={row.daysLeft <= 7 ? "warning" : "info"}>{`${row.daysLeft} day${row.daysLeft === 1 ? "" : "s"} left`}</StatusBadge>;
}

export function MsmePaymentsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const list = useListState("msme-payments", { view: "all", filters: {} });
  const bucket = list.view.replace(/-/g, "_");
  const [pageIndex, setPageIndex] = usePageIndex([bucket, list.search]);
  const filters = useMemo(() => ({ bucket: bucket === "all" ? undefined : bucket, search: list.search.trim() || undefined, ...pageFilters(pageIndex) }), [bucket, list.search, pageIndex]);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "msme-payments", filters), queryFn: () => listMsmePayments(filters), placeholderData: (previous) => previous });
  const rows = query.data?.rows ?? [];
  const columns = useMemo<ColumnDef<MsmeRow, unknown>[]>(() => [
    { id: "bill", header: "Bill", cell: ({ row }) => <span><span className="font-medium tabular-nums">{row.original.billNumber}</span>
      {row.original.supplierInvoice && <span className="block text-xs text-text-muted">{row.original.supplierInvoice}</span>}</span> },
    { id: "supplier", header: "Supplier", cell: ({ row }) => <span>{row.original.supplierName}
      <span className="block text-xs capitalize text-text-muted">{[row.original.classification, row.original.udyam].filter(Boolean).join(" · ")}</span></span> },
    { id: "accepted", header: "Accepted", cell: ({ row }) => <span>{calendarDate(row.original.acceptanceDate)}<span className="block text-xs text-text-muted">{row.original.sourceReference}</span></span> },
    { id: "deadline", header: "Pay by", cell: ({ row }) => <span>{calendarDate(row.original.statutoryDueDate)}<span className="block text-xs text-text-muted">{row.original.statutoryDays} days</span></span> },
    { id: "left", header: "Status", cell: ({ row }) => <DaysLeft row={row.original} /> },
    { id: "outstanding", header: "Still owed", cell: ({ row }) => <span className="font-medium tabular-nums">{money(row.original.currencyCode, row.original.outstanding)}</span> },
  ], []);
  const counts = new Map((query.data?.buckets ?? []).map((entry) => [entry.key, entry]));
  return (
    <div className="flex flex-col gap-4">
    <EnterpriseListPage header={{ title: "MSME Payments",
      description: <>Bills to micro and small suppliers against their legal deadline: the agreed days (45 at most), else 15, from acceptance. Paid late, legal interest is due and the expense is disallowed under section 43B(h). Pay from the bill or from <Link className="text-brand hover:underline" href="/procurement/reports/payment-obligations">Due &amp; Overdue</Link>.</> }}
      savedViews={{ views: BUCKETS.map((entry) => ({ id: entry.key, label: counts.get(entry.key) ? `${entry.label} (${counts.get(entry.key)?.count})` : entry.label })), activeViewId: bucket,
        onSelect: (next) => list.setView(next.replace(/_/g, "-")) }}
      actionBar={{ start: <SearchField aria-label="Search MSME payments" placeholder="Bill, invoice or supplier" className="w-full sm:w-80" value={list.search} onChange={list.setSearch} /> }}>
      <EnterpriseDataGrid<MsmeRow> aria-label="MSME payments" columns={columns} data={rows} getRowId={(row) => row.id} {...gridPaging(query.data?.total ?? 0, pageIndex, setPageIndex)}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (list.search || bucket !== "all" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading MSME payments" rows={6} />}
        errorContent={<ErrorState title="Could not load MSME payments" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />}
        emptyContent={<EmptyState title="Nothing owed to MSME suppliers" description="Bills to suppliers marked micro or small (with their Udyam number) appear here once final." />}
        noResultsContent={<NoResultsState title="Nothing in this view" description="Try another view or search." />}
        onRowClick={(row) => router.push(row.href)}
        renderMobileCard={(row) => <div className="flex flex-col gap-1"><span className="font-medium tabular-nums">{row.billNumber} · {row.supplierName}</span>
          <span className="flex flex-wrap items-center gap-1 text-xs text-text-muted">Pay by {calendarDate(row.statutoryDueDate)} · {money(row.currencyCode, row.outstanding)} <DaysLeft row={row} /></span></div>} />
    </EnterpriseListPage>
    <ReturnsPanel />
    </div>
  );
}

// The halves and financial years offered: the last four halves, the last three years (a financial year starts in April).
function periods() {
  const now = new Date();
  const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  // The current half first (April–September is H1), then back one half at a time.
  let year = fy;
  let second = now.getMonth() >= 9 || now.getMonth() < 3;
  const halves: Array<{ value: string; label: string }> = [];
  while (halves.length < 4) {
    halves.push(second ? { value: `${year}-H2`, label: `October ${year} – March ${year + 1}` } : { value: `${year}-H1`, label: `April – September ${year}` });
    if (second) second = false; else { second = true; year -= 1; }
  }
  return { halves, years: [fy, fy - 1, fy - 2].map((year) => ({ value: String(year), label: `${year}–${String(year + 1).slice(2)} (31 March ${year + 1})` })) };
}

// MSME-1 (half-yearly, to the Registrar) and the figures at 31 March (s.43B(h), the s.16 interest).
function ReturnsPanel() {
  const { halves, years } = useMemo(periods, []);
  const [half, setHalf] = useState(halves[1]?.value ?? halves[0].value);
  const [year, setYear] = useState(years[0].value);
  const [bankRate, setBankRate] = useState("6.5");
  const msme1 = useQuery({ queryKey: ["procurement", "msme-1", half], queryFn: () => getMsme1(half) });
  const yearEnd = useQuery({ queryKey: ["procurement", "msme-year-end", year, bankRate], queryFn: () => getMsmeYearEnd(Number(year), bankRate), enabled: Number(bankRate) > 0 });
  const inr = (value: string | undefined) => (value === undefined ? "—" : money("INR", value));
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Panel title="MSME-1" description="Owed to micro and small suppliers past the deadline at the half-year's end.">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Select label="Half-year" className="sm:w-72" selectedKey={half} onSelectionChange={(value) => setHalf(String(value))} options={halves} />
            <a className={buttonVariants({ variant: "secondary" })} href={msme1CsvUrl(half)} download><Download className="size-4" aria-hidden="true" />Download (CSV)</a>
          </div>
          {msme1.error ? <p className="text-sm text-danger">{errorMessage(msme1.error)}</p> : (
            <p className="text-sm text-text-secondary">{msme1.data ? `${msme1.data.rows.length} bill${msme1.data.rows.length === 1 ? "" : "s"}, ${inr(msme1.data.total)}, as at ${calendarDate(msme1.data.asOf)}. Add the reason for each delay before filing.` : "Loading…"}</p>
          )}
        </div>
      </Panel>
      <Panel title="At the year end" description="For the accounts and the tax audit: what is owed to micro and small suppliers at 31 March.">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select label="Financial year" selectedKey={year} onSelectionChange={(value) => setYear(String(value))} options={years} />
            <TextField label="Bank rate (% a year)" inputMode="decimal" value={bankRate} onChange={(value) => setBankRate(value.replace(/[^0-9.]/g, ""))} description="Interest is three times this." />
          </div>
          {yearEnd.error ? <p className="text-sm text-danger">{errorMessage(yearEnd.error)}</p> : (
            <Facts columns={3} items={[
              { label: "Owed to micro and small", value: inr(yearEnd.data?.owed) },
              { label: "Past the deadline (s.43B(h))", value: inr(yearEnd.data?.pastDue) },
              { label: "Interest (s.16, estimate)", value: inr(yearEnd.data?.interest) },
            ]} />
          )}
          <p className="text-xs text-text-muted">The part past the deadline is not allowed as an expense until paid. Interest is on what is still unpaid.</p>
        </div>
      </Panel>
    </div>
  );
}
