"use client";

// Sales → Outstanding (Sales audit M7): what each customer owes and since when — not yet due, 1–30, 31–60, 61–90 and over 90 days past due,
// less the credits they hold — for the customers the person may see.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, TextField } from "@vercentlabs/design-system";

import { useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { SalesApiError } from "@/features/sales/shared/http";

import { getCustomerOutstanding, type CustomerOutstanding } from "../api/customers-api";

type Row = CustomerOutstanding["rows"][number];
const amount = (value: number) => value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const figure = (value: number, danger = false) => <span className={`tabular-nums ${danger && value > 0 ? "text-danger" : ""}`}>{value ? amount(value) : "—"}</span>;

export function CustomerOutstandingScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [asOf, setAsOf] = useState("");
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
    { id: "notDue", accessorKey: "notDue", header: "Not yet due", cell: ({ row }) => figure(row.original.notDue) },
    { id: "d1_30", accessorKey: "d1_30", header: "1–30", cell: ({ row }) => figure(row.original.d1_30, true) },
    { id: "d31_60", accessorKey: "d31_60", header: "31–60", cell: ({ row }) => figure(row.original.d31_60, true) },
    { id: "d61_90", accessorKey: "d61_90", header: "61–90", cell: ({ row }) => figure(row.original.d61_90, true) },
    { id: "over90", accessorKey: "over90", header: "Over 90", cell: ({ row }) => figure(row.original.over90, true) },
    { id: "credits", accessorKey: "credits", header: "Credits", cell: ({ row }) => figure(row.original.credits) },
    { id: "net", accessorKey: "net", header: "Owes", cell: ({ row }) => <span className="font-medium tabular-nums">{amount(row.original.net)}</span> },
    { id: "oldestDaysPastDue", accessorKey: "oldestDaysPastDue", header: "Oldest overdue", cell: ({ row }) => (row.original.oldestDaysPastDue ? `${row.original.oldestDaysPastDue} days` : "—") },
  ], []);

  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to customer balances" description="Ask an administrator for the View customer financials permission." />;
  const data = query.data;
  return (
    <EnterpriseListPage
      header={{
        title: "Outstanding",
        description: data
          ? `What customers owe as of ${data.asOf}, in ${data.currencyCode}: ${amount(data.totals.net ?? 0)} in all, ${amount((data.totals.d1_30 ?? 0) + (data.totals.d31_60 ?? 0) + (data.totals.d61_90 ?? 0) + (data.totals.over90 ?? 0))} past due.`
          : "What customers owe, and since when.",
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
        aria-label="Outstanding by customer"
        columns={columns}
        data={paged.pageRows}
        getRowId={(row) => row.partyId}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (submitted ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading outstanding" rows={6} />}
        errorContent={<ErrorState title="Could not load outstanding" action={{ label: "Try again", onPress: () => void query.refetch() }} />}
        emptyContent={<EmptyState title="Nothing outstanding" description="Every posted invoice is paid." />}
        noResultsContent={<NoResultsState title="No customer matches" description="Try another search." />}
        {...paged.grid}
        onRowClick={(row) => router.push(`/sales/customers/${row.partyId}?tab=ledger`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.name}</span><span className="tabular-nums">{amount(row.net)}</span></span>
            <span className="text-xs text-text-muted">{row.oldestDaysPastDue ? `Oldest overdue ${row.oldestDaysPastDue} days` : "Nothing overdue"}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
