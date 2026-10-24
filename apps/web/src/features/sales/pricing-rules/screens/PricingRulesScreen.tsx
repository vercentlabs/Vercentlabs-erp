"use client";

// Sales → Schemes & Rates (Sales audit M3): special rates for a customer, discounts and quantity slabs, and free-goods schemes — the
// rules quotations and orders are priced with on top of the price list.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, Select, StatusBadge } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { errorCode, errorMessage } from "@/features/sales/price-lists/api/price-lists-api";

import { listPricingRules, setPricingRuleStatus, type PricingRule } from "../api/pricing-rules-api";
import { PricingRuleDialog } from "../components/PricingRuleDialog";

const ANY = "any";
const VIEWS = [{ id: ANY, label: "All" }, { id: "active", label: "Active" }, { id: "inactive", label: "Switched off" }];
const validity = (rule: PricingRule) =>
  rule.validFrom || rule.validTo ? [rule.validFrom ? `from ${formatDate(rule.validFrom)}` : null, rule.validTo ? `until ${formatDate(rule.validTo)}` : null].filter(Boolean).join(" ") : "Always";

export function PricingRulesScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [status, setStatus] = useState(ANY);
  const [type, setType] = useState(ANY);
  const [editing, setEditing] = useState<PricingRule | "new" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const filters = { search: submitted || undefined, status: status === ANY ? undefined : status, type: type === ANY ? undefined : type };
  const key = scopedQueryKey(workspace, "sales", "pricing-rules");
  const query = useQuery({ queryKey: [...key, filters], queryFn: () => listPricingRules(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => query.data?.rules ?? [], [query.data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "priority", desc: false }] });
  const can = query.data?.capabilities;
  const change = useMutation({
    mutationFn: ({ rule, action }: { rule: PricingRule; action: "activate" | "deactivate" | "delete" }) => setPricingRuleStatus(rule.id, action),
    onSuccess: () => { setFailure(null); void queryClient.invalidateQueries({ queryKey: key }); },
    onError: (error) => setFailure(errorMessage(error)),
  });
  const columns = useMemo<ColumnDef<PricingRule, unknown>[]>(() => [
    { id: "name", accessorKey: "name", header: "Scheme or rate", cell: ({ row }) => (
      <span className="flex flex-col"><span className="font-medium text-text">{row.original.name}</span><span className="text-xs text-text-muted">{row.original.code} · {row.original.typeLabel}</span></span>
    ) },
    { id: "who", accessorKey: "who", header: "For", cell: ({ row }) => row.original.who },
    { id: "what", accessorKey: "what", header: "On", cell: ({ row }) => row.original.what },
    { id: "summary", accessorKey: "summary", header: "Gives", enableSorting: false, cell: ({ row }) => row.original.summary },
    { id: "validity", header: "Valid", enableSorting: false, cell: ({ row }) => (
      <span className="whitespace-nowrap">{validity(row.original)}{row.original.isActive && !row.original.isCurrent ? <span className="text-xs text-warning"> · not today</span> : null}</span>
    ) },
    { id: "priority", accessorKey: "priority", header: "Priority", cell: ({ row }) => <span className="tabular-nums">{row.original.priority}</span> },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={row.original.isActive ? "success" : "neutral"}>{row.original.isActive ? "Active" : "Off"}</StatusBadge> },
    ...(can?.manage ? [{ id: "actions", header: "", enableSorting: false, cell: ({ row }: { row: { original: PricingRule } }) => (
      <span className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
        <Button size="compact" variant="ghost" onPress={() => change.mutate({ rule: row.original, action: row.original.isActive ? "deactivate" : "activate" })}>
          {row.original.isActive ? "Switch off" : "Switch on"}
        </Button>
        {row.original.usedOnLines === 0 && <Button size="compact" variant="ghost" onPress={() => change.mutate({ rule: row.original, action: "delete" })}>Delete</Button>}
      </span>
    ) } satisfies ColumnDef<PricingRule, unknown>] : []),
  ], [can?.manage, change]);

  if (query.isError && errorCode(query.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to schemes and rates" description="Ask an administrator for access to price lists." />;
  const filtered = Boolean(submitted) || status !== ANY || type !== ANY;
  return (
    <>
      <EnterpriseListPage
        header={{
          title: "Schemes & offers",
          description: "Special rates, discounts, quantity slabs and free goods, applied on top of the price list.",
          primaryAction: can?.manage ? <Button variant="primary" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New scheme or rate</Button> : undefined,
        }}
        savedViews={{ views: VIEWS, activeViewId: status, onSelect: (id) => { setStatus(id); paged.resetPage(); } }}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search schemes and rates" placeholder="Search name, customer or product" className="w-full sm:w-80" value={search} onChange={setSearch} />
              <Select aria-label="Kind" size="compact" selectedKey={type} onSelectionChange={(value) => setType(String(value))}
                options={[{ value: ANY, label: "Every kind" }, ...(query.data?.types ?? []).map((entry) => ({ value: entry.code, label: entry.label }))]} />
            </>
          ),
        }}
      >
        {failure && <p role="alert" className="mb-3 text-sm text-danger">{failure}</p>}
        <EnterpriseDataGrid<PricingRule>
          aria-label="Schemes and rates"
          columns={columns}
          data={paged.pageRows}
          getRowId={(row) => row.id}
          state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (filtered ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading schemes and rates" rows={6} />}
          errorContent={<ErrorState title="Could not load schemes and rates" action={{ label: "Try again", onPress: () => void query.refetch() }} />}
          emptyContent={<EmptyState title="No schemes or rates yet" description="Give a customer its own rate, add quantity slabs, or run a buy 10 get 1 free scheme."
            action={can?.manage ? { label: "New scheme or rate", onPress: () => setEditing("new") } : undefined} />}
          noResultsContent={<NoResultsState title="Nothing matches" description="Try another view, kind or search." />}
          {...paged.grid}
          onRowClick={can?.manage ? (row) => setEditing(row) : undefined}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.name}</span>
                <StatusBadge tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Off"}</StatusBadge></span>
              <span className="text-xs text-text-muted">{row.who} · {row.what} · {row.summary}</span>
            </div>
          )}
        />
      </EnterpriseListPage>
      {editing && (
        <PricingRuleDialog rule={editing === "new" ? undefined : editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void queryClient.invalidateQueries({ queryKey: key }); }} />
      )}
    </>
  );
}
