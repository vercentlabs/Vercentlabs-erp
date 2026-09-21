"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Lock, Mail, MessageSquare, Phone } from "lucide-react";
import {
  Button,
  EnterpriseDataGrid,
  EnterpriseListPage,
  ErrorState,
  NoResultsState,
  PermissionState,
  SearchField,
  StatusBadge,
  type ActiveFilter,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { CommunicationApiError, listCommunications } from "../api/communications-api";
import type { Communication, CommunicationListFilters } from "../types";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";

const PAGE_SIZE = 25;

const channelIcon: Record<string, typeof Mail> = { email: Mail, whatsapp: MessageSquare, sms: MessageSquare, call_log: Phone };

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function CommunicationListScreen() {
  const router = useRouter();
  const workspace = useWorkspaceContext();

  const [filters, setFilters] = useState<CommunicationListFilters>({ limit: PAGE_SIZE, offset: 0 });
  const [searchInput, setSearchInput] = useState("");

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "communications", filters),
    queryFn: () => listCommunications(filters),
    placeholderData: (previous) => previous,
  });

  function updateFilter<K extends keyof CommunicationListFilters>(key: K, value: CommunicationListFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, offset: 0 }));
  }

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const active: ActiveFilter[] = [];
    if (filters.status) active.push({ id: "status", label: `Status: ${filters.status}` });
    if (filters.search) active.push({ id: "search", label: `Search: ${filters.search}` });
    return active;
  }, [filters]);

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const pageIndex = Math.floor((filters.offset ?? 0) / PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: ColumnDef<Communication, unknown>[] = useMemo(
    () => [
      {
        id: "channel",
        header: "Channel",
        accessorKey: "channel",
        cell: ({ row }) => {
          const Icon = channelIcon[row.original.channel] ?? Mail;
          return (
            <span className="flex items-center gap-1.5">
              <Icon className="size-3.5 text-text-muted" aria-hidden="true" />
              {row.original.channel}
            </span>
          );
        },
      },
      { id: "direction", header: "Direction", accessorFn: (row) => row.direction || "—" },
      {
        id: "subject",
        header: "Subject",
        accessorFn: (row) => (row.contentVisibility === "metadata" ? null : row.subject),
        cell: ({ row }) =>
          row.original.contentVisibility === "metadata" ? (
            <span className="flex items-center gap-1.5 text-text-muted">
              <Lock className="size-3.5" aria-hidden="true" />
              Restricted — participant only
            </span>
          ) : (
            <span className="text-text">{row.original.subject || "—"}</span>
          ),
      },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone="neutral">{String(getValue())}</StatusBadge>,
      },
      { id: "occurredAt", header: "Occurred", accessorFn: (row) => dateTimeFormatter.format(new Date(row.occurredAt)) },
    ],
    [],
  );

  const gridState = query.isLoading
    ? "loading"
    : query.isError && query.error instanceof CommunicationApiError && query.error.status === 403
      ? "permission-denied"
      : query.isError
        ? "error"
        : rows.length === 0
          ? "empty"
          : "ready";

  return (
    <EnterpriseListPage
      header={{
        title: "Communications",
        description: "Email, WhatsApp, SMS and call-log history across your CRM records. Subject/body are only visible to the sender or an authorized reviewer, never to every record viewer.",
      }}
      actionBar={{
        start: (
          <SearchField
            aria-label="Search communications"
            placeholder="Search by subject…"
            value={searchInput}
            onChange={setSearchInput}
            onKeyDown={(event) => event.key === "Enter" && updateFilter("search", searchInput || undefined)}
            className="min-w-[240px]"
          />
        ),
        end: <Button variant="secondary" onPress={() => updateFilter("search", searchInput || undefined)}>Search</Button>,
      }}
      filterBar={{
        filters: activeFilters,
        onRemove: (id) => setFilters((current) => ({ ...current, [id]: undefined, offset: 0 })),
        onClearAll: activeFilters.length > 0 ? () => { setSearchInput(""); setFilters({ limit: PAGE_SIZE, offset: 0 }); } : undefined,
      }}
    >
      <EnterpriseDataGrid<Communication>
        aria-label="Communications"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        state={gridState}
        loadingContent={<LoadingState label="Loading communications" rows={3} />}
        emptyContent={<NoResultsState title="No communications yet" />}
        errorContent={<ErrorState title="Could not load communications" action={{ label: "Retry", onPress: () => query.refetch() }} />}
        permissionDeniedContent={<PermissionState title="You don't have access to Communications" />}
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        pageCount={pageCount}
        totalRowCount={total}
        onPageChange={(nextIndex) => setFilters((current) => ({ ...current, offset: nextIndex * PAGE_SIZE }))}
        onRowClick={(row) => {
          if (row.leadId) router.push(`/crm/leads/${row.leadId}`);
          else if (row.opportunityId) router.push(`/crm/opportunities/${row.opportunityId}`);
          else if (row.partyId) router.push(`/crm/accounts/${row.partyId}`);
          else if (row.contactId) router.push(`/crm/contacts/${row.contactId}`);
        }}
      />
    </EnterpriseListPage>
  );
}
