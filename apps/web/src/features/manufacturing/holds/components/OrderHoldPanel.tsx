"use client";

// An order's production holds: the one in force (its reasons and who must clear them) and every earlier episode with its downtime.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus } from "@/features/manufacturing/orders/api/mo-api";
import { HOLDS_BASE, SEVERITY_TONE, STATUS_TONE, duration, holdHistory } from "../api/hold-api";

// The banner for an order on hold (on its Overview).
export function OrderHoldBanner({ orderId }: { orderId: string }) {
  const workspace = useWorkspaceContext();
  const history = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "order-holds", orderId), queryFn: () => holdHistory(orderId), retry: false });
  const active = history.data?.episodes.find((row) => row.status === "ACTIVE");
  if (!active) return null;
  return (
    <Notice tone={active.severity === "CRITICAL" ? "danger" : "warning"}>
      <span className="flex flex-wrap items-center gap-2">
        <span>On hold since {formatDateTime(active.startedAt)} ({duration(active.durationHours)}{active.overdue ? ", overdue" : ""}): {active.reasons.join(", ")}.</span>
        {active.waitingOn.length > 0 && <span>Waiting on {active.waitingOn.join(", ").toLowerCase()} to clear {active.openReasons === 1 ? "it" : `${active.openReasons} reasons`}.</span>}
        {active.openReasons === 0 && <span>Every reason is cleared: check readiness and resume.</span>}
        <Link className="text-brand underline" href={`${HOLDS_BASE}/${active.id}`}>Open {active.number}</Link>
      </span>
    </Notice>
  );
}

export function OrderHoldHistoryPanel({ orderId }: { orderId: string }) {
  const workspace = useWorkspaceContext();
  const history = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "order-holds", orderId), queryFn: () => holdHistory(orderId), retry: false });
  if (history.isError && errorStatus(history.error) === 403) return null;
  const rows = history.data?.episodes ?? [];
  return (
    <Panel title="Hold history" description={rows.length ? `Total downtime ${duration(history.data?.totalDowntimeHours ?? 0)}: each hold counts once, however many reasons it had.` : undefined}>
      {history.isError ? <p className="text-sm text-danger">{errorMessage(history.error)}</p> : rows.length ? (
        <LinesTable columns={["Hold", "Status", "Severity", "Reasons", "Started", "Ended", { label: "Duration", numeric: true }]}>
          {rows.map((row) => (
            <tr key={row.id}>
              <Cell><Link className="text-brand underline" href={`${HOLDS_BASE}/${row.id}`}>{row.number}</Link></Cell>
              <Cell><StatusBadge tone={STATUS_TONE[row.status]}>{row.statusLabel}</StatusBadge></Cell>
              <Cell><StatusBadge tone={SEVERITY_TONE[row.severity]}>{row.severity.toLowerCase()}</StatusBadge></Cell>
              <Cell>{row.reasons.join(", ")}</Cell><Cell>{formatDateTime(row.startedAt)}</Cell><Cell>{row.resolvedAt ? formatDateTime(row.resolvedAt) : "—"}</Cell>
              <Cell numeric>{duration(row.durationHours)}</Cell>
            </tr>
          ))}
        </LinesTable>
      ) : <p className="text-sm text-text-muted">{history.isLoading ? "Loading…" : "Never held."}</p>}
    </Panel>
  );
}
