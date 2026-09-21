"use client";

import { useQuery } from "@tanstack/react-query";
import { MetricStrip, PageHeader, PermissionState, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@vercentlabs/design-system";

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
          <Table className="w-full text-sm">
            <TableHead className="text-left text-text-muted"><TableRow><TableHeaderCell className="py-1">Agent</TableHeaderCell><TableHeaderCell>Total</TableHeaderCell><TableHeaderCell>Resolved</TableHeaderCell><TableHeaderCell>Avg. first response</TableHeaderCell><TableHeaderCell>Avg. resolution</TableHeaderCell><TableHeaderCell>Breaches</TableHeaderCell><TableHeaderCell>CSAT</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={String(a.assigned_user_id)} className="border-t border-border">
                  <TableCell className="py-1">{String(a.assigned_user_id)}</TableCell>
                  <TableCell>{quantity(a.total_tickets)}</TableCell>
                  <TableCell>{quantity(a.resolved_tickets)}</TableCell>
                  <TableCell>{a.avg_first_response_minutes === null ? "—" : `${quantity(a.avg_first_response_minutes)} min`}</TableCell>
                  <TableCell>{a.avg_resolution_minutes === null ? "—" : `${quantity(a.avg_resolution_minutes)} min`}</TableCell>
                  <TableCell>{quantity(a.breached_resolutions)}</TableCell>
                  <TableCell>{a.avg_csat === null ? "—" : quantity(a.avg_csat)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
        <Table className="w-full text-sm">
          <TableHead className="text-left text-text-muted"><TableRow><TableHeaderCell className="py-1">Priority</TableHeaderCell><TableHeaderCell>Covered</TableHeaderCell><TableHeaderCell>First response met</TableHeaderCell><TableHeaderCell>First response breached</TableHeaderCell><TableHeaderCell>Resolution met</TableHeaderCell><TableHeaderCell>Resolution breached</TableHeaderCell></TableRow></TableHead>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={String(p.priority)} className="border-t border-border">
                <TableCell className="py-1">{label(p.priority)}</TableCell>
                <TableCell>{quantity(p.covered)}</TableCell>
                <TableCell>{quantity(p.first_response_met)}</TableCell>
                <TableCell>{quantity(p.first_response_breached)}</TableCell>
                <TableCell>{quantity(p.resolution_met)}</TableCell>
                <TableCell>{quantity(p.resolution_breached)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SupportPanel>
    </div>
  );
}
