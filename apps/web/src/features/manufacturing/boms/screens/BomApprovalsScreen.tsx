"use client";

// Pending BOM approvals: every revision waiting for a decision, oldest first, with who submitted it and why. A row opens the revision, where
// it is approved or rejected; one the person submitted themselves is marked (an independent approver decides unless the company allows it).
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, PermissionState, StatusBadge } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { usePagedRows } from "@/shared/ui/list";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus, pendingApprovals, type PendingApproval } from "../api/bom-api";
import { BOM_BASE } from "./BomListScreen";

export function BomApprovalsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "bom-approvals"), queryFn: pendingApprovals });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const paged = usePagedRows(rows);
  const columns = useMemo<ColumnDef<PendingApproval, unknown>[]>(() => [
    { id: "bom", header: "BOM", cell: ({ row }) => <span className="font-medium text-text">{row.original.bomNumber} · Rev {row.original.revisionNumber}</span> },
    { id: "product", accessorKey: "product", header: "Product" },
    { id: "change", header: "Change", cell: ({ row }) => `${row.original.changeReason ?? ""}${row.original.basedOn ? ` (from rev ${row.original.basedOn})` : ""}` },
    { id: "lines", accessorKey: "lines", header: "Materials", cell: ({ row }) => <span className="tabular-nums">{row.original.lines}</span> },
    { id: "submitted", header: "Submitted", cell: ({ row }) => `${row.original.submittedAt ? formatDateTime(row.original.submittedAt) : ""}${row.original.submittedBy ? ` · ${row.original.submittedBy}` : ""}` },
    { id: "decision", header: "Your decision", cell: ({ row }) => row.original.canApprove ? <StatusBadge tone="warning">Awaiting you</StatusBadge>
      : row.original.selfSubmitted ? <StatusBadge tone="neutral">Submitted by you</StatusBadge> : <StatusBadge tone="neutral">View only</StatusBadge> },
  ], []);
  if (query.isError && errorStatus(query.error) === 403) return <PermissionState title="You don't have access to bills of materials" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage header={{ title: "Pending BOM Approvals", description: "BOM revisions waiting for a decision. Approval binds to the exact recipe submitted; any change sends it back for approval." }}>
      <EnterpriseDataGrid<PendingApproval>
        aria-label="Pending BOM approvals" columns={columns} data={paged.pageRows} getRowId={(row) => row.revisionId}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
        loadingContent={<LoadingState label="Loading approvals" rows={5} />}
        errorContent={<ErrorState title="Could not load approvals" description={errorMessage(query.error)} />}
        emptyContent={<EmptyState title="Nothing waiting for approval" description="Submitted BOM revisions appear here until they are approved or rejected." />}
        {...paged.grid}
        onRowClick={(row) => router.push(`${BOM_BASE}/${row.bomId}?revision=${row.revisionId}`)}
      />
    </EnterpriseListPage>
  );
}
