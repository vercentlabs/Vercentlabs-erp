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
import { formatDateTime, humanize } from "@/features/crm/shared/human";
import { ViewToggle } from "@/features/crm/shared/ui/ViewToggle";

const PAGE_SIZE = 25;

const channelIcon: Record<string, typeof Mail> = { email: Mail, whatsapp: MessageSquare, sms: MessageSquare, call_log: Phone };


const CHANNEL_TABS = [
  { id: "all", label: "All" },
  { id: "email", label: "Email" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "sms", label: "SMS" },
  { id: "call_log", label: "Calls" },
];

const kindOf = (row: Communication) => (row.leadId ? "Lead" : row.opportunityId ? "Opportunity" : row.partyId ? "Account" : row.contactId ? "Contact" : "");

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
    if (filters.status) active.push({ id: "status", label: `Status: ${humanize(filters.status)}` });
    if (filters.direction) active.push({ id: "direction", label: `Direction: ${humanize(filters.direction)}` });
    if (filters.channel) active.push({ id: "channel", label: `Channel: ${filters.channel === "call_log" ? "Calls" : humanize(filters.channel)}` });
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
            <span className="flex flex-col">
              <span className="flex items-center gap-1.5 font-medium text-text">
                <Icon className="size-3.5 text-text-muted" aria-hidden="true" />
                {row.original.channel === "call_log" ? "Call" : humanize(row.original.channel)}
              </span>
              {row.original.direction && <span className="text-xs text-text-muted">{humanize(row.original.direction)}</span>}
            </span>
          );
        },
      },
      {
        id: "subject",
        header: "Message",
        accessorFn: (row) => (row.contentVisibility === "metadata" ? null : row.subject),
        cell: ({ row }) =>
          row.original.contentVisibility === "metadata" ? (
            <span className="flex items-center gap-1.5 text-text-muted">
              <Lock className="size-3.5" aria-hidden="true" />
              Restricted. Only the sender or an authorized reviewer can read it.
            </span>
          ) : (
            <span className="flex flex-col">
              <span className="text-text">{row.original.subject || "No subject"}</span>
              {row.original.body && <span className="line-clamp-1 max-w-md text-xs text-text-muted">{row.original.body}</span>}
            </span>
          ),
      },
      {
        id: "people",
        header: "From and to",
        accessorFn: (row) => row.fromAddress ?? "",
        cell: ({ row }) =>
          row.original.contentVisibility === "metadata" ? (
            <span className="text-text-muted">Restricted</span>
          ) : (
            <span className="flex flex-col text-xs">
              <span className="text-text">{row.original.fromAddress || "Unknown sender"}</span>
              {row.original.toAddresses && row.original.toAddresses.length > 0 && <span className="text-text-muted">{`to ${row.original.toAddresses.slice(0, 2).join(", ")}${row.original.toAddresses.length > 2 ? ` +${row.original.toAddresses.length - 2}` : ""}`}</span>}
            </span>
          ),
      },
      { id: "related", header: "Related to", accessorFn: (row) => kindOf(row), cell: ({ row }) => (kindOf(row.original) ? <span className="text-brand">{kindOf(row.original)}</span> : <span className="text-text-muted">Not linked</span>) },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone="neutral">{String(getValue())}</StatusBadge>,
      },
      { id: "occurredAt", header: "When", accessorFn: (row) => formatDateTime(row.occurredAt) },
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
        description: "Email, WhatsApp, SMS and calls across your CRM records. A message is readable only by its sender or an authorized reviewer.",
      }}
      actionBar={{
        start: (
          <>
          <ViewToggle label="Channel" options={CHANNEL_TABS} value={filters.channel ?? "all"} onChange={(id) => updateFilter("channel", id === "all" ? undefined : id)} />
          <SearchField
            aria-label="Search communications"
            placeholder="Search by subject…"
            value={searchInput}
            onChange={setSearchInput}
            onKeyDown={(event) => event.key === "Enter" && updateFilter("search", searchInput || undefined)}
            className="min-w-[240px]"
          />
          </>
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
        emptyContent={<NoResultsState title={filters.channel || filters.search ? "No messages match" : "No communications yet"} description={filters.channel || filters.search ? "Try another channel or clear the search." : "Messages appear here once a channel is connected in Settings, or when a call is logged."} />}
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
