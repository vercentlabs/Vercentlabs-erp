"use client";

// Supplier payments: awaiting approval, approved and waiting to be posted, posted (and what each settled), money not yet applied (an advance
// to the supplier), reversed and discarded. A row opens the payment.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, StatusBadge } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { PAYMENT_STATUS, errorMessage, errorStatus, inr, listPayments, methodLabel, type Payment } from "../api/payables-api";

const VIEWS = [{ id: "all", label: "All" }, { id: "approval", label: "Awaiting approval" }, { id: "to_post", label: "To post or fix" }, { id: "unapplied", label: "With money to apply" },
  { id: "reversed", label: "Reversed / discarded" }];

export function PaymentsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const filters = { view: view === "all" ? undefined : view, search: submitted || undefined };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "payments", filters), queryFn: () => listPayments(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const paged = usePagedRows(rows);
  const mayPay = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("accounting.payments.manage");

  const columns: ColumnDef<Payment, unknown>[] = [
    { id: "number", accessorKey: "number", header: "Payment", enableHiding: false, cell: ({ row }) => <span className="font-medium text-text">{row.original.number}</span> },
    { id: "date", accessorKey: "date", header: "Date", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{formatDate(row.original.date)}</span> },
    { id: "party", accessorKey: "party", header: "Supplier" },
    { id: "method", accessorKey: "method", header: "How", cell: ({ row }) => (
      <span className="flex flex-col"><span>{methodLabel(row.original.method)}</span>{row.original.reference && <span className="text-xs text-text-muted">{row.original.reference}</span>}</span>) },
    { id: "amount", accessorKey: "amount", header: "Amount", cell: ({ row }) => <span className="tabular-nums">{inr(row.original.amount, row.original.currency)}</span> },
    { id: "unapplied", accessorKey: "unapplied", header: "Not yet applied", cell: ({ row }) => row.original.unapplied > 0
      ? <span className="font-medium tabular-nums text-warning">{inr(row.original.unapplied, row.original.currency)}</span> : <span className="text-text-muted">—</span> },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={PAYMENT_STATUS[row.original.status].tone}>{PAYMENT_STATUS[row.original.status].label}</StatusBadge> },
  ];

  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage
      header={{
        title: "Supplier Payments",
        description: "Money paid to suppliers. A payment is prepared with the bills it pays; where approval is required a second person approves it before it is posted.",
        primaryAction: mayPay ? <LinkButton href="/accounting/payments/new" variant="primary"><Plus className="size-4" aria-hidden="true" />Pay supplier</LinkButton> : undefined,
      }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{ start: <SearchField aria-label="Search payments" placeholder="Payment, supplier or reference" className="w-full sm:w-72" value={search} onChange={setSearch} /> }}
    >
      <EnterpriseDataGrid<Payment>
        aria-label="Supplier payments" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (submitted || view !== "all" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading payments" rows={8} />}
        errorContent={<ErrorState title="Could not load payments" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No supplier payments yet" description="Pay a supplier from its bills, or with Pay supplier." />}
        noResultsContent={<NoResultsState title="Nothing here" description="Try another view or search." />}
        {...paged.grid}
        onRowClick={(row) => router.push(`/accounting/payments/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span>
              <StatusBadge tone={PAYMENT_STATUS[row.status].tone}>{PAYMENT_STATUS[row.status].label}</StatusBadge></span>
            <span className="text-xs text-text-muted">{row.party} · {formatDate(row.date)} · {inr(row.amount, row.currency)}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
