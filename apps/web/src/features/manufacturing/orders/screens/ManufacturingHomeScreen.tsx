"use client";

// The Manufacturing overview: orders by state, what waits for a decision (order and BOM approvals, inspection), what is late and short,
// and the orders in production with their progress.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, LinkButton, PageHeader, PermissionState, StatusBadge } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { Cell, FactList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, STATUS_TONE, errorMessage, errorStatus, manufacturingHome, qty } from "../api/mo-api";

export function ManufacturingHomeScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "home"), queryFn: manufacturingHome });
  if (query.isLoading) return <LoadingState label="Loading Manufacturing" rows={6} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to manufacturing orders" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load Manufacturing" description={errorMessage(query.error)} />;
  }
  const home = query.data;
  const can = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("manufacturing.mo.create");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Manufacturing" description="Production authorised against approved recipes; stock through Inventory, cost through Finance."
        primaryAction={can ? <LinkButton href={`${MO_BASE}/new`} variant="primary">New manufacturing order</LinkButton> : undefined} />
      <FactList items={[
        ["Drafts", String(home.counts.DRAFT)],
        ["Awaiting approval", String(home.counts.AWAITING_APPROVAL)], ["Released", String(home.counts.RELEASED)], ["In progress", String(home.counts.IN_PROGRESS)], ["On hold", String(home.counts.ON_HOLD)],
        ["Late", String(home.overdue)], ["Awaiting inspection", qty(home.awaitingInspection)], ["BOM revisions awaiting approval", String(home.pendingBomApprovals)],
        ["Open material demand", String(home.openMaterialDemand)],
      ]} />
      <Panel title="In production" description="Released, in progress and held orders, earliest due first.">
        {home.inProgress.length ? (
          <LinesTable columns={["Order", "Product", "Status", { label: "Accepted / planned", numeric: true }, "Due"]}>
            {home.inProgress.map((row) => (
              <tr key={row.id}><Cell><Link className="text-brand underline" href={`${MO_BASE}/${row.id}`}>{row.number}</Link></Cell><Cell>{row.item}</Cell>
                <Cell><StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>{row.statusLabel}</StatusBadge></Cell>
                <Cell numeric>{qty(row.accepted)} / {qty(row.planned)} ({row.progressPct}%)</Cell><Cell>{formatDate(row.dueAt)}</Cell></tr>
            ))}
          </LinesTable>
        ) : <p className="text-sm text-text-muted">Nothing in production.</p>}
      </Panel>
    </div>
  );
}
