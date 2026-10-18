"use client";

// Assets — the Overview and the Asset Register directory. The overview counts what needs attention (each count opens the register already
// filtered); the register lists the assets the person may see — the Company's for the asset team, the ones in their care for an employee —
// with views, search, filters, sorting and paging on the server, and a scan box that opens an asset from its QR label, code, serial or tag.
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, RowSelectionState, SortingState } from "@tanstack/react-table";
import {
  Button, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, Select, StatusBadge, TextField,
} from "@vercentlabs/design-system";

import { filterBarOf, useDebouncedValue } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  AVAILABILITY_TONE, LIFECYCLE_TONE, REGISTER_BASE, WARRANTY_LABEL, dateLabel, errorMessage, errorStatus, exportHref, getOptions, identifiersExportHref, listAssets, lookup, money,
  type AssetRow, type BulkResult, type Candidate,
} from "./register-api";
import { CandidateList } from "./IdentificationScreens";
import { BulkResultDialog, BulkStatusActions, bulkAsk } from "./StatusScreens";
import { bulkLocation } from "../locations/locations-api";
import { AskDialog, type Ask } from "@/shared/ui/AskDialog";

// A scanner types the label's payload and presses Enter; a person can type an asset code, serial or tag. Access is checked on the server.
export function ScanBox({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<Candidate[] | null>(null);
  const go = async () => {
    if (!value.trim()) return;
    setBusy(true); setError(null); setMatches(null);
    try {
      const found = await lookup(value.trim());
      if (found.ambiguous || !found.href) setMatches(found.matches);
      else router.push(`${found.href}?via=${found.method === "QR" ? "qr" : "search"}`);
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <div className={`flex flex-col gap-1 ${compact ? "" : "max-w-xl"}`}>
      <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); void go(); }}>
        <TextField label="Scan or find an asset" placeholder="Scan a QR or barcode label, or type an asset code, serial, tag or previous code" value={value} onChange={setValue} className="grow" />
        <Button type="submit" variant="secondary" isLoading={busy} isDisabled={!value.trim()}>Open</Button>
      </form>
      {error && <p className="text-sm text-danger">{error}</p>}
      {matches && <CandidateList matches={matches} />}
    </div>
  );
}

const VIEWS = [{ id: "all", label: "All assets" }, { id: "active", label: "Active" }, { id: "available", label: "Available" }, { id: "maintenance", label: "Under maintenance" },
  { id: "on_hold", label: "On hold" }, { id: "lost", label: "Missing / lost" }, { id: "drafts", label: "Not yet commissioned" }, { id: "ended", label: "Retired / disposed / lost" }, { id: "mine", label: "In my care" }];
const FILTER_KEYS = ["categoryId", "lifecycle", "availability", "holdReason", "condition", "locationId", "custodianId", "capitalization", "ownership", "warranty", "filter", "archived"] as const;
const SORT_ID: Record<string, string> = { code: "code", name: "name", category: "category", location: "location", custodian: "custodian", lifecycle: "lifecycle", statusChangedAt: "status", purchaseDate: "purchase", warrantyEndDate: "warranty" };
const FILTER_LABEL: Record<string, string> = { unverified: "Not verified in the period", no_source: "No acquisition source", unassigned: "In use, unassigned", missing_serial: "Missing serial or tag" };

export function AssetRegisterScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState(VIEWS.some((row) => row.id === params.get("view")) ? params.get("view")! : "all");
  const [search, setSearch] = useState(params.get("search") ?? "");
  const term = useDebouncedValue(search);
  const [filters, setFilters] = useState<Partial<Record<(typeof FILTER_KEYS)[number], string>>>(() => Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? undefined]).filter(([, v]) => v)));
  const [sorting, setSorting] = useState<SortingState>([{ id: "code", desc: false }]);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<RowSelectionState>({});
  const [ask, setAsk] = useState<Ask | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "options"), queryFn: getOptions, staleTime: 60_000, retry: false });
  const query = { view, search: term || undefined, ...filters, sort: SORT_ID[sorting[0]?.id ?? "code"] ?? "code", direction: sorting[0]?.desc ? "desc" : "asc", page: page + 1, pageSize: 25 };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "register", JSON.stringify(query)), queryFn: () => listAssets(query), retry: false });
  const setFilter = (key: (typeof FILTER_KEYS)[number]) => (value: string | null) => {
    const next = { ...filters, [key]: value ?? undefined };
    setFilters(next); setPage(0);
    const url = new URLSearchParams({ view, ...Object.fromEntries(Object.entries(next).filter(([, v]) => v)) as Record<string, string> });
    router.replace(`${pathname}?${url.toString()}`, { scroll: false });
  };
  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to the asset register" description="Ask an administrator for access." />;
  const can = list.data?.can;
  const rows = list.data?.rows ?? [];
  const nameOf = (list2: Array<{ id: string; name: string }> | undefined, id?: string) => list2?.find((row) => row.id === id)?.name ?? "";
  const labels = options.data?.labels ?? {};
  const columns: ColumnDef<AssetRow>[] = [
    { id: "code", header: "Asset", accessorKey: "code", cell: ({ row }) => <span className="flex flex-col"><Link className="font-medium text-brand hover:underline" href={row.original.href}>{row.original.code}</Link><span className="text-xs text-text-muted">{row.original.name}</span></span> },
    { id: "category", header: "Category", accessorKey: "category" },
    { id: "serial", header: "Serial / tag", enableSorting: false, cell: ({ row }) => <span className="text-xs">{row.original.serialNumber ?? "—"}{row.original.tagCode ? <span className="block text-text-muted">{row.original.tagCode}</span> : null}</span> },
    { id: "location", header: "Location", accessorKey: "location", cell: ({ row }) => row.original.location ?? "—" },
    { id: "custodian", header: "Custodian", accessorKey: "custodian", cell: ({ row }) => row.original.custodian ?? row.original.department ?? "—" },
    { id: "lifecycle", header: "Lifecycle", accessorKey: "lifecycle", cell: ({ row }) => <span className="flex flex-col gap-1"><StatusBadge tone={LIFECYCLE_TONE[row.original.lifecycle]}>{row.original.lifecycleLabel}</StatusBadge>
      {row.original.holdReasonLabel && <span className="text-xs text-text-muted">{row.original.holdReasonLabel}</span>}{row.original.missingReported && <span className="text-xs text-danger">Reported missing</span>}</span> },
    { id: "availability", header: "Availability", enableSorting: false, cell: ({ row }) => <StatusBadge tone={AVAILABILITY_TONE[row.original.availability]}>{row.original.availabilityLabel}</StatusBadge> },
    { id: "condition", header: "Condition", enableSorting: false, cell: ({ row }) => row.original.conditionLabel ?? "—" },
    { id: "statusChangedAt", header: "Last status change", accessorKey: "statusChangedAt", cell: ({ row }) => dateLabel(row.original.statusChangedAt) },
    { id: "purchaseDate", header: "Acquired", accessorKey: "purchaseDate", cell: ({ row }) => dateLabel(row.original.purchaseDate) },
    { id: "warrantyEndDate", header: "Warranty", accessorKey: "warrantyEndDate", cell: ({ row }) => row.original.warrantyEndDate ? <span className={row.original.warranty === "EXPIRED" ? "text-text-muted" : row.original.warranty === "EXPIRING" ? "text-warning" : ""}>{dateLabel(row.original.warrantyEndDate)}</span> : "—" },
    ...(can?.financials ? [{ id: "carrying", header: "Carrying amount", enableSorting: false, cell: ({ row }: { row: { original: AssetRow } }) => row.original.capitalizationClass === "CAPITALIZED" ? money(row.original.carryingAmount ?? null) : <span className="text-xs text-text-muted">{row.original.capitalizationClass === "TRACKED_ONLY" ? "Tracked only" : "Not capitalized"}</span> }] as ColumnDef<AssetRow>[] : []),
  ];
  const chips = [
    { id: "categoryId", active: Boolean(filters.categoryId), label: `Category: ${nameOf(options.data?.categories, filters.categoryId)}`, clear: () => setFilter("categoryId")(null) },
    { id: "lifecycle", active: Boolean(filters.lifecycle), label: `Status: ${labels.lifecycle?.[filters.lifecycle ?? ""] ?? filters.lifecycle}`, clear: () => setFilter("lifecycle")(null) },
    { id: "availability", active: Boolean(filters.availability), label: `Availability: ${labels.availability?.[filters.availability ?? ""] ?? filters.availability}`, clear: () => setFilter("availability")(null) },
    { id: "holdReason", active: Boolean(filters.holdReason), label: `On hold: ${labels.holdReason?.[filters.holdReason ?? ""] ?? filters.holdReason}`, clear: () => setFilter("holdReason")(null) },
    { id: "condition", active: Boolean(filters.condition), label: `Condition: ${labels.condition?.[filters.condition ?? ""] ?? filters.condition}`, clear: () => setFilter("condition")(null) },
    { id: "locationId", active: Boolean(filters.locationId), label: `Location: ${nameOf(options.data?.locations, filters.locationId)}`, clear: () => setFilter("locationId")(null) },
    { id: "custodianId", active: Boolean(filters.custodianId), label: `Custodian: ${nameOf(options.data?.users, filters.custodianId)}`, clear: () => setFilter("custodianId")(null) },
    { id: "capitalization", active: Boolean(filters.capitalization), label: labels.capitalization?.[filters.capitalization ?? ""] ?? "", clear: () => setFilter("capitalization")(null) },
    { id: "ownership", active: Boolean(filters.ownership), label: labels.ownership?.[filters.ownership ?? ""] ?? "", clear: () => setFilter("ownership")(null) },
    { id: "warranty", active: Boolean(filters.warranty), label: filters.warranty === "expired" ? "Warranty expired" : "Warranty ending soon", clear: () => setFilter("warranty")(null) },
    { id: "filter", active: Boolean(filters.filter), label: FILTER_LABEL[filters.filter ?? ""] ?? "", clear: () => setFilter("filter")(null) },
    { id: "archived", active: Boolean(filters.archived), label: "Archived assets", clear: () => setFilter("archived")(null) },
  ];
  const filtered = Boolean(term || Object.values(filters).some(Boolean));
  // Location in bulk: the initial location of assets not yet commissioned, or one transfer request each for commissioned ones.
  const locationAsk = (action: "initial-location" | "bulk-transfer"): Ask => ({
    title: action === "initial-location" ? `Set the initial location of ${Object.keys(selected).length} asset(s)` : `Request a transfer for ${Object.keys(selected).length} asset(s)`,
    confirm: action === "initial-location" ? "Set location" : "Request transfers",
    description: action === "initial-location" ? "Only for assets not yet commissioned; commissioned assets move through a transfer and are listed with the reason." : "One transfer per asset; each asset's location changes when its transfer completes.",
    fields: [{ name: "locationId", label: "Location", kind: "select", required: true, options: (options.data?.locations ?? []).map((l) => ({ value: l.id, label: l.name })) },
      ...(action === "bulk-transfer" ? [{ name: "reason", label: "Reason", kind: "textarea" as const, required: true }] : [])],
    run: async (v) => {
      const ids = Object.keys(selected);
      const result = await bulkLocation(action, action === "initial-location" ? { assetIds: ids, locationId: v.locationId } : { assetIds: ids, toLocationId: v.locationId, reason: v.reason });
      setBulkResult({ action, ...result }); setSelected({}); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") });
    } });
  return (
    <EnterpriseListPage
      header={{ title: "Asset Register", description: "One record per physical asset: its identity, where it is, who looks after it, and its acquisition source.",
        primaryAction: can?.create ? <LinkButton variant="primary" href={`${REGISTER_BASE}/new`}>Add asset</LinkButton> : undefined,
        secondaryActions: (
          <span className="flex flex-wrap gap-2">
            {can?.registerBulk && <LinkButton variant="secondary" href={`${REGISTER_BASE}/from-purchase`}>Register from purchase</LinkButton>}
            {can?.import && <LinkButton variant="secondary" href={`${REGISTER_BASE}/import`}>Import</LinkButton>}
            {can?.printLabels && <LinkButton variant="secondary" href={`${REGISTER_BASE}/labels`}>Print labels</LinkButton>}
            {can?.export && <LinkButton variant="secondary" href={exportHref({ view, search: term || undefined, ...filters })}>Export</LinkButton>}
            {can?.exportIdentifiers && <LinkButton variant="ghost" href={identifiersExportHref}>Export identifiers</LinkButton>}
          </span>
        ) }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); setPage(0); router.replace(`${pathname}?view=${id}`, { scroll: false }); } }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search assets" placeholder="Code, name, serial, tag, previous code or model" className="w-full sm:w-80" value={search} onChange={(value) => { setSearch(value); setPage(0); }} />
            <Select aria-label="Category" label="Category" size="compact" placeholder="Any category" selectedKey={filters.categoryId ?? null} onSelectionChange={(key) => setFilter("categoryId")(key ? String(key) : null)}
              options={(options.data?.categories ?? []).map((row) => ({ value: row.id, label: row.name }))} />
            <Select aria-label="Location" label="Location" size="compact" placeholder="Any location" selectedKey={filters.locationId ?? null} onSelectionChange={(key) => setFilter("locationId")(key ? String(key) : null)}
              options={(options.data?.locations ?? []).map((row) => ({ value: row.id, label: row.name }))} />
            <Select aria-label="Custodian" label="Custodian" size="compact" placeholder="Anyone" selectedKey={filters.custodianId ?? null} onSelectionChange={(key) => setFilter("custodianId")(key ? String(key) : null)}
              options={(options.data?.users ?? []).map((row) => ({ value: row.id, label: row.name }))} />
            <Select aria-label="Availability" label="Availability" size="compact" placeholder="Any availability" selectedKey={filters.availability ?? null} onSelectionChange={(key) => setFilter("availability")(key ? String(key) : null)}
              options={Object.entries(labels.availability ?? {}).map(([value, label]) => ({ value, label }))} />
            <Select aria-label="Hold reason" label="Hold reason" size="compact" placeholder="Any hold" selectedKey={filters.holdReason ?? null} onSelectionChange={(key) => setFilter("holdReason")(key ? String(key) : null)}
              options={Object.entries(labels.holdReason ?? {}).map(([value, label]) => ({ value, label }))} />
            <Select aria-label="Condition" label="Condition" size="compact" placeholder="Any condition" selectedKey={filters.condition ?? null} onSelectionChange={(key) => setFilter("condition")(key ? String(key) : null)}
              options={Object.entries(labels.condition ?? {}).map(([value, label]) => ({ value, label }))} />
            <Select aria-label="Tracking" label="Tracking" size="compact" placeholder="Fixed and tracked" selectedKey={filters.capitalization ?? null} onSelectionChange={(key) => setFilter("capitalization")(key ? String(key) : null)}
              options={Object.entries(labels.capitalization ?? {}).map(([value, label]) => ({ value, label }))} />
            <Select aria-label="Ownership" label="Ownership" size="compact" placeholder="Any ownership" selectedKey={filters.ownership ?? null} onSelectionChange={(key) => setFilter("ownership")(key ? String(key) : null)}
              options={Object.entries(labels.ownership ?? {}).map(([value, label]) => ({ value, label }))} />
            <Select aria-label="Needs attention" label="Needs attention" size="compact" placeholder="Everything" selectedKey={filters.filter ?? null} onSelectionChange={(key) => setFilter("filter")(key ? String(key) : null)}
              options={Object.entries(FILTER_LABEL).map(([value, label]) => ({ value, label }))} />
            <Select aria-label="Warranty" label="Warranty" size="compact" placeholder="Any warranty" selectedKey={filters.warranty ?? null} onSelectionChange={(key) => setFilter("warranty")(key ? String(key) : null)}
              options={[{ value: "expiring", label: "Ending soon" }, { value: "expired", label: "Expired" }]} />
            <Button size="compact" variant="ghost" onPress={() => setFilter("archived")(filters.archived ? null : "true")}>{filters.archived ? "Hide archived" : "Show archived"}</Button>
          </>
        ),
      }}
      filterBar={filterBarOf(chips, () => setPage(0))}
      bulkActionBar={can?.bulkStatus && Object.keys(selected).length ? { selectedCount: Object.keys(selected).length, onClearSelection: () => setSelected({}),
        actions: <span className="flex flex-wrap gap-2"><BulkStatusActions count={Object.keys(selected).length} onPick={(action) => setAsk(bulkAsk(action, Object.keys(selected), options.data, (result) => {
          setBulkResult(result); setSelected({}); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") });
        }))} />
          <Button size="compact" variant="secondary" onPress={() => setAsk(locationAsk("initial-location"))}>Set initial location</Button>
          <Button size="compact" variant="secondary" onPress={() => setAsk(locationAsk("bulk-transfer"))}>Request transfer</Button></span> } : undefined}
    >
      <div className="mb-3"><ScanBox compact /></div>
      {list.isError && errorStatus(list.error) !== 403 && <Notice tone="danger">{errorMessage(list.error)}</Notice>}
      <EnterpriseDataGrid<AssetRow>
        aria-label="Assets" columns={columns} data={rows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (filtered || view !== "all" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading assets" rows={8} />}
        errorContent={<ErrorState title="Could not load assets" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No assets yet" description="Add an asset, register the units of a purchase, or import your existing register."
          action={can?.create ? { label: "Add asset", onPress: () => router.push(`${REGISTER_BASE}/new`) } : undefined} />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try another view, search or filter." />}
        sorting={sorting} onSortingChange={(next) => { setSorting(next); setPage(0); }} manualSorting
        pageIndex={page} pageSize={25} pageCount={list.data?.pages ?? 1} totalRowCount={list.data?.total ?? 0} onPageChange={setPage}
        onRowClick={(row) => router.push(row.href)}
        enableRowSelection={Boolean(can?.bulkStatus)} rowSelection={selected} onRowSelectionChange={setSelected}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-start justify-between gap-2"><span className="min-w-0 truncate font-medium">{row.name}</span><StatusBadge tone={LIFECYCLE_TONE[row.lifecycle]}>{row.lifecycleLabel}</StatusBadge></span>
            <span className="text-xs text-text-muted">{`${row.code}${row.serialNumber ? ` · ${row.serialNumber}` : ""} · ${row.location ?? "No location"} · ${row.custodian ?? "Unassigned"}`}</span>
            {row.warranty === "EXPIRING" && <span className="text-xs text-warning">{WARRANTY_LABEL.EXPIRING}</span>}
          </div>
        )}
      />
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
      {bulkResult && <BulkResultDialog result={bulkResult} onClose={() => setBulkResult(null)} />}
    </EnterpriseListPage>
  );
}
