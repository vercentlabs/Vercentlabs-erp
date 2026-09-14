"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RowSelectionState } from "@tanstack/react-table";
import {
  ActionBar,
  Avatar,
  buttonVariants,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  EnterpriseDataGrid,
  FilterBar,
  Input,
  PageHeader,
  PageShell,
  RowActionsIcon,
  SelectContent,
  SelectItem,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  type EnterpriseDataGridColumn,
} from "@vercentlabs/ui-web";

interface LeadRow {
  id: string;
  code: string;
  fullName: string;
  companyName: string | null;
  status: string;
  score: number | null;
  estimatedValue: number | null;
  currencyCode: string | null;
  nextFollowUpAt: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  priority: string | null;
  rating: string | null;
}

interface Option {
  id: string;
  name: string;
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" {
  const value = status.toLowerCase();
  if (value === "archived" || value === "lost" || value === "unqualified") return "danger";
  if (value === "converted" || value === "qualified" || value === "won") return "success";
  if (value === "working" || value === "contacted") return "warning";
  return "neutral";
}

function formatCurrency(value: number | null, currencyCode: string | null) {
  if (value === null || value === undefined) return "—";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currencyCode || "INR", maximumFractionDigits: 0 }).format(value);
  } catch {
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
  }
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(date);
}

export function LeadsListView({
  rows,
  total,
  page,
  pageSize,
  search,
  status,
  sourceId,
  ownerId,
  sources,
  owners,
  stages,
  canManage,
}: {
  rows: LeadRow[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  status: string;
  sourceId: string;
  ownerId: string;
  sources: Option[];
  owners: Option[];
  stages: Array<{ id: string; code: string; name: string }>;
  canManage: boolean;
  canAssignOwner: boolean;
}) {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState(search);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const stageName = (code: string) => stages.find((stage) => stage.code === code)?.name || code.replaceAll("_", " ");

  function navigate(next: Partial<{ search: string; status: string; sourceId: string; ownerId: string; page: number }>) {
    const merged = { search, status, sourceId, ownerId, page, ...next };
    const params = new URLSearchParams();
    if (merged.search) params.set("search", merged.search);
    if (merged.status) params.set("status", merged.status);
    if (merged.sourceId) params.set("sourceId", merged.sourceId);
    if (merged.ownerId) params.set("ownerId", merged.ownerId);
    if (merged.page > 1) params.set("page", String(merged.page));
    const suffix = params.toString();
    router.push(`/crm/leads-next${suffix ? `?${suffix}` : ""}`);
  }

  const columns: EnterpriseDataGridColumn<LeadRow>[] = [
    { id: "code", accessorKey: "code", header: "Code", size: 90 },
    {
      id: "fullName",
      accessorKey: "fullName",
      header: "Lead",
      cell: ({ row }) => (
        <Link href={`/crm/leads-next/${row.original.id}`} className="font-medium text-[var(--color-action-primary)] hover:underline">
          {row.original.fullName}
        </Link>
      ),
    },
    { id: "companyName", accessorKey: "companyName", header: "Company", cell: ({ getValue }) => (getValue() as string) || "—" },
    {
      id: "status",
      accessorKey: "status",
      header: "Stage",
      cell: ({ getValue }) => <StatusBadge tone={statusTone(getValue() as string)}>{stageName(getValue() as string)}</StatusBadge>,
    },
    { id: "score", accessorKey: "score", header: "Score", cell: ({ getValue }) => (getValue() ?? "—") as string },
    {
      id: "estimatedValue",
      accessorKey: "estimatedValue",
      header: "Value",
      cell: ({ row }) => formatCurrency(row.original.estimatedValue, row.original.currencyCode),
    },
    {
      id: "ownerName",
      accessorKey: "ownerName",
      header: "Owner",
      cell: ({ row }) =>
        row.original.ownerName ? (
          <span className="flex items-center gap-2">
            <Avatar name={row.original.ownerName} size="compact" />
            {row.original.ownerName}
          </span>
        ) : (
          <span className="text-[var(--color-text-muted)]">Unassigned</span>
        ),
      sensitive: true,
    },
    {
      id: "nextFollowUpAt",
      accessorKey: "nextFollowUpAt",
      header: "Next follow-up",
      cell: ({ getValue }) => formatDate(getValue() as string),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Leads"
        description={`${total} lead${total === 1 ? "" : "s"} · UI 2.0 preview -- create/edit/board still open in the existing CRM workspace`}
        actions={
          canManage ? (
            <Link href="/crm/leads?create=1" className={buttonVariants({ variant: "primary" })}>
              New lead
            </Link>
          ) : undefined
        }
      />

      <FilterBar
        search={
          <Input
            placeholder="Search leads..."
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") navigate({ search: searchInput, page: 1 });
            }}
            aria-label="Search leads"
          />
        }
      >
        <SelectRoot value={status || null} onValueChange={(value) => navigate({ status: (value as string) || "", page: 1 })}>
          <SelectTrigger className="w-40" aria-label="Filter by stage">
            <SelectValue>{(value: string | null) => (value ? stageName(value) : "All stages")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All stages</SelectItem>
            {stages.map((stage) => (
              <SelectItem key={stage.id} value={stage.code}>
                {stage.name}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>

        <SelectRoot value={sourceId || null} onValueChange={(value) => navigate({ sourceId: (value as string) || "", page: 1 })}>
          <SelectTrigger className="w-40" aria-label="Filter by source">
            <SelectValue>{(value: string | null) => (value ? sources.find((s) => s.id === value)?.name || value : "All sources")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All sources</SelectItem>
            {sources.map((source) => (
              <SelectItem key={source.id} value={source.id}>
                {source.name}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>

        <SelectRoot value={ownerId || null} onValueChange={(value) => navigate({ ownerId: (value as string) || "", page: 1 })}>
          <SelectTrigger className="w-40" aria-label="Filter by owner">
            <SelectValue>{(value: string | null) => (value ? owners.find((o) => o.id === value)?.name || value : "All owners")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All owners</SelectItem>
            {owners.map((owner) => (
              <SelectItem key={owner.id} value={owner.id}>
                {owner.name}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>
      </FilterBar>

      <EnterpriseDataGrid
        aria-label="Leads"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        pageIndex={page - 1}
        pageSize={pageSize}
        totalRows={total}
        onPageChange={(nextPageIndex) => navigate({ page: nextPageIndex + 1 })}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        bulkActions={
          <ActionBar>
            <Link href="/crm/leads" className={buttonVariants({ variant: "secondary", size: "compact" })}>
              Open selection in CRM workspace
            </Link>
          </ActionBar>
        }
        onRowClick={(row) => router.push(`/crm/leads-next/${row.id}`)}
        renderRowActions={(row) => (
          <DropdownMenuRoot>
            <DropdownMenuTrigger aria-label={`Actions for ${row.fullName}`} className="flex size-8 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-muted)] hover:bg-[var(--color-canvas-strong)]">
              <RowActionsIcon className="size-4" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => router.push(`/crm/leads-next/${row.id}`)}>View 360</DropdownMenuItem>
              {canManage ? (
                <DropdownMenuItem onClick={() => router.push(`/crm/leads?edit=${row.id}`)}>Edit</DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => router.push(`/crm/leads/${row.id}`)}>Open full workspace</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuRoot>
        )}
        emptyState={{ title: "No leads yet", description: canManage ? "Create your first lead to get started." : undefined }}
      />
    </PageShell>
  );
}
