"use client";

// Sales › Dispatch › E-way Bills (Sales plan): every e-way bill made for an invoice, a delivery or a challan — number, date, valid until,
// vehicle and value — newest first, with views for those expiring within a day, cancelled or refused. What still needs one is listed in
// E-invoices & e-way bills due.
import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, StatusBadge } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { SalesApiError, request } from "@/features/sales/shared/http";
import { dateTime, money } from "@/features/sales/shared/format";

type Row = { id: string; sourceType: "sales_invoice" | "sales_delivery" | "sales_challan"; sourceId: string; sourceNumber: string; ewbNumber: string | null; ewbDate: string | null;
  validUntil: string | null; status: "generated" | "cancelled" | "failed"; vehicleNumber: string | null; transportMode: string | null; distanceKm: number | null; error: string | null;
  value: number | null; consignee: string | null; createdAt: string };
const PAGE_SIZE = 25;
const SOURCE = { sales_invoice: { label: "Invoice", href: "/sales/invoices/" }, sales_delivery: { label: "Delivery", href: "/sales/deliveries/" }, sales_challan: { label: "Challan", href: "/sales/challans/" } };
const VIEWS = [{ id: "all", label: "All" }, { id: "generated", label: "Live" }, { id: "expiring", label: "Expiring in a day" }, { id: "cancelled", label: "Cancelled" }, { id: "failed", label: "Refused" }];
const TONE = { generated: "success", cancelled: "neutral", failed: "danger" } as const;

export function EwayBillsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = params.get("view") ?? "all";
  const submitted = params.get("q") ?? "";
  const [search, setSearch] = useState(submitted);
  const pageIndex = Math.max(0, (Number(params.get("page")) || 1) - 1);
  const go = (next: Record<string, string>) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) if (value && value !== "all") query.set(key, value); else query.delete(key);
    if (!("page" in next)) query.delete("page");
    router.replace(query.size ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "eway-bills", view, submitted, pageIndex),
    queryFn: () => request<{ rows: Row[]; total: number }>(`/eway-bills?${new URLSearchParams({ status: view === "all" ? "" : view, search: submitted, limit: String(PAGE_SIZE), offset: String(pageIndex * PAGE_SIZE) })}`),
    placeholderData: keepPreviousData,
  });
  const rows = query.data?.rows ?? [];
  const columns = useMemo<ColumnDef<Row, unknown>[]>(() => [
    { id: "ewb", header: "E-way bill", cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.ewbNumber ?? "—"}</span> },
    { id: "source", header: "For", cell: ({ row }) => (
      <Link className="text-brand hover:underline" href={`${SOURCE[row.original.sourceType].href}${row.original.sourceId}`} onClick={(event) => event.stopPropagation()}>
        {SOURCE[row.original.sourceType].label} {row.original.sourceNumber}
      </Link>
    ) },
    { id: "consignee", header: "Consignee", cell: ({ row }) => row.original.consignee ?? "—" },
    { id: "value", header: "Value", cell: ({ row }) => <span className="tabular-nums">{row.original.value != null ? money("INR", row.original.value) : "—"}</span> },
    { id: "vehicle", header: "Vehicle", cell: ({ row }) => row.original.vehicleNumber ?? "Part B pending" },
    { id: "date", header: "Generated", cell: ({ row }) => (row.original.ewbDate ? dateTime(row.original.ewbDate) : "—") },
    { id: "valid", header: "Valid until", cell: ({ row }) => (row.original.validUntil ? dateTime(row.original.validUntil) : "—") },
    { id: "status", header: "Status", cell: ({ row }) => <span className="flex flex-col"><StatusBadge tone={TONE[row.original.status]}>{row.original.status === "generated" ? "Live" : row.original.status === "failed" ? "Refused" : "Cancelled"}</StatusBadge>
      {row.original.error && <span className="text-xs text-danger">{row.original.error}</span>}</span> },
  ], []);
  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to e-way bills" description="It needs access to deliveries or invoices." />;
  return (
    <EnterpriseListPage
      header={{ title: "E-way Bills", description: "E-way bills made for invoices, deliveries and challans. A consignment worth more than ₹50,000 needs one before it moves.",
        primaryAction: <LinkButton variant="secondary" href="/sales/gst-documents">What still needs one</LinkButton> }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => go({ view: id }) }}
      actionBar={{ start: <SearchField aria-label="Search e-way bills" placeholder="Search e-way bill, document or vehicle" className="w-full sm:w-80" value={search} onChange={setSearch} onSubmit={(value) => go({ q: value.trim() })} /> }}
    >
      <EnterpriseDataGrid<Row>
        aria-label="E-way bills"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (submitted || view !== "all" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading e-way bills" rows={6} />}
        errorContent={<ErrorState title="Could not load e-way bills" action={{ label: "Try again", onPress: () => void query.refetch() }} />}
        emptyContent={<EmptyState title="No e-way bills yet" description="Make one from a dispatched delivery, an issued challan or a posted invoice (its GST tab)." />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try another view or search." />}
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        pageCount={Math.max(1, Math.ceil((query.data?.total ?? 0) / PAGE_SIZE))}
        totalRowCount={query.data?.total ?? 0}
        onPageChange={(page) => go({ page: page > 0 ? String(page + 1) : "" })}
        onRowClick={(row) => router.push(`${SOURCE[row.sourceType].href}${row.sourceId}${row.sourceType === "sales_invoice" ? "?tab=gst" : ""}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="font-medium tabular-nums">{row.ewbNumber ?? "—"} · {SOURCE[row.sourceType].label} {row.sourceNumber}</span>
            <span className="text-xs text-text-muted">{[row.vehicleNumber, row.validUntil && `valid until ${dateTime(row.validUntil)}`].filter(Boolean).join(" · ")}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
