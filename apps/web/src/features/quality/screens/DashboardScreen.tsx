"use client";

import { useQuery } from "@tanstack/react-query";
import { MetricStrip, PageHeader, PermissionState } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { readView, type Row } from "@/features/quality/shared/client";
import { label, quantity } from "@/features/quality/shared/format";
import { QualityPanel } from "@/features/quality/shared/QualityUi";

// F342: the KPI dashboard, plus F341's cost report underneath.
export function QualityDashboardScreen() {
  const workspace = useWorkspaceContext();
  const kpi = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "dashboard"), queryFn: () => readView<{ dashboard: Row }>("dashboard").then((r) => r.dashboard) });
  const cost = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "cost-report"), queryFn: () => readView<{ report: Row }>("cost-report").then((r) => r.report), enabled: !kpi.isError });
  if (kpi.isError) return <PermissionState title="You don't have access to Quality" description="Ask an administrator to grant quality.view." />;
  const d = kpi.data;
  const c = cost.data;
  const bySeverity = (c?.bySeverity ?? []) as Row[];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Quality" description="Inspections, holds, non-conformances, CAPA, calibration and complaints, at a glance." />
      {d && (
        <MetricStrip metrics={[
          { label: "Open inspections", value: quantity(d.open_inspections) },
          { label: "First-pass yield", value: d.first_pass_yield === null ? "—" : `${quantity(d.first_pass_yield)}%` },
          { label: "Active holds", value: quantity(d.active_holds) },
          { label: "Open non-conformances", value: quantity(d.open_nonconformances) },
          { label: "Open critical NC", value: quantity(d.open_critical_nonconformances) },
          { label: "Open CAPA", value: quantity(d.open_capa) },
          { label: "Overdue CAPA", value: quantity(d.overdue_capa) },
          { label: "Overdue calibrations", value: quantity(d.overdue_calibrations) },
          { label: "Open complaints", value: quantity(d.open_complaints) },
        ]} />
      )}
      {c && (
        <QualityPanel title="Cost of quality" description="Estimated cost of non-conformances, by severity.">
          <MetricStrip metrics={[{ label: "Total estimated cost", value: quantity(c.totalEstimatedCost) }, ...bySeverity.map((s) => ({ label: `${label(s.severity)} (${quantity(s.n)})`, value: quantity(s.cost) }))]} />
        </QualityPanel>
      )}
    </div>
  );
}
