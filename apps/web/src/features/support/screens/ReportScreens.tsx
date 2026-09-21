"use client";

import { useQuery } from "@tanstack/react-query";
import { MetricStrip, PageHeader, PermissionState } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { readView, type Row } from "@/features/support/shared/client";
import { label, quantity } from "@/features/support/shared/format";
import { SupportPanel } from "@/features/support/shared/SupportUi";

const denied = (
  <PermissionState title="You don't have access to support reports" description="Ask an administrator to grant support.reports.view." />
);

// F376: CSAT
export function CsatReportScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "support", "csat-report"), queryFn: () => readView<{ report: Row }>("csat-report").then((r) => r.report) });
  if (query.isError) return denied;
  const r = query.data;
  const byAgent = (r?.byAgent ?? []) as Row[];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Customer satisfaction" description="Ratings customers left after their ticket was resolved, 1 (worst) to 5 (best)." />
      {r && <MetricStrip metrics={[{ label: "Responses", value: quantity(r.responses) }, { label: "Average", value: quantity(r.average) }, { label: "Satisfied (4-5)", value: quantity(r.satisfied) }, { label: "Dissatisfied (1-2)", value: quantity(r.dissatisfied) }]} />}
      <SupportPanel title="By agent">
        <ul className="text-sm">
          {byAgent.map((a) => <li key={String(a.assigned_user_id)}>{String(a.assigned_user_id)} — {quantity(a.average)} average over {quantity(a.responses)} response(s)</li>)}
          {byAgent.length === 0 && <li className="text-text-muted">No ratings yet.</li>}
        </ul>
      </SupportPanel>
    </div>
  );
}

// F377: agent performance
export function AgentPerformanceScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "support", "agent-performance"), queryFn: () => readView<{ rows: Row[] }>("agent-performance").then((r) => r.rows) });
  if (query.isError) return denied;
  const rows = query.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Agent performance" description="Volume, response and resolution speed, SLA breaches, and satisfaction, per agent." />
      <SupportPanel>
        {rows.length === 0 ? <p className="text-sm text-text-muted">No assigned tickets yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-text-muted"><tr><th className="py-1">Agent</th><th>Total</th><th>Resolved</th><th>Avg. first response</th><th>Avg. resolution</th><th>Breaches</th><th>CSAT</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={String(a.assigned_user_id)} className="border-t border-border">
                  <td className="py-1">{String(a.assigned_user_id)}</td>
                  <td>{quantity(a.total_tickets)}</td>
                  <td>{quantity(a.resolved_tickets)}</td>
                  <td>{a.avg_first_response_minutes === null ? "—" : `${quantity(a.avg_first_response_minutes)} min`}</td>
                  <td>{a.avg_resolution_minutes === null ? "—" : `${quantity(a.avg_resolution_minutes)} min`}</td>
                  <td>{quantity(a.breached_resolutions)}</td>
                  <td>{a.avg_csat === null ? "—" : quantity(a.avg_csat)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SupportPanel>
    </div>
  );
}

// F378: SLA reporting
export function SlaReportScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "support", "sla-report"), queryFn: () => readView<{ report: Row }>("sla-report").then((r) => r.report) });
  if (query.isError) return denied;
  const r = query.data;
  const rows = (r?.byPriority ?? []) as Row[];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="SLA report" description="First-response and resolution performance by priority, and what is currently at risk." />
      {r && <MetricStrip metrics={[{ label: "First-response at risk now", value: quantity(r.first_response_at_risk) }, { label: "Resolution at risk now", value: quantity(r.resolution_at_risk) }]} />}
      <SupportPanel title="By priority">
        <table className="w-full text-sm">
          <thead className="text-left text-text-muted"><tr><th className="py-1">Priority</th><th>Covered</th><th>First response met</th><th>First response breached</th><th>Resolution met</th><th>Resolution breached</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={String(p.priority)} className="border-t border-border">
                <td className="py-1">{label(p.priority)}</td>
                <td>{quantity(p.covered)}</td>
                <td>{quantity(p.first_response_met)}</td>
                <td>{quantity(p.first_response_breached)}</td>
                <td>{quantity(p.resolution_met)}</td>
                <td>{quantity(p.resolution_breached)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SupportPanel>
    </div>
  );
}
