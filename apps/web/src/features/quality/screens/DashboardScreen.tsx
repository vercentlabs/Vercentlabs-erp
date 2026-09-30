"use client";

import { useQuery } from "@tanstack/react-query";
import {
  MetricStrip,
  PageHeader,
  PermissionState,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { readView, type Row } from "@/features/quality/shared/client";
import { quantity } from "@/features/quality/shared/format";

// F342: the Quality KPI dashboard.
export function QualityDashboardScreen() {
  const workspace = useWorkspaceContext();
  const kpi = useQuery({
    queryKey: scopedQueryKey(workspace, "quality", "dashboard"),
    queryFn: () =>
      readView<{ dashboard: Row }>("dashboard").then((r) => r.dashboard),
  });
  if (kpi.isError)
    return (
      <PermissionState
        title="You don't have access to Quality"
        description="Ask an administrator to grant quality.view."
      />
    );
  const d = kpi.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Quality"
        description="Inspections, holds and non-conformances, at a glance."
      />
      {d && (
        <MetricStrip
          metrics={[
            { label: "Open inspections", value: quantity(d.open_inspections) },
            {
              label: "First-pass yield",
              value:
                d.first_pass_yield === null
                  ? "—"
                  : `${quantity(d.first_pass_yield)}%`,
            },
            { label: "Active holds", value: quantity(d.active_holds) },
            {
              label: "Open non-conformances",
              value: quantity(d.open_nonconformances),
            },
            {
              label: "Open critical NC",
              value: quantity(d.open_critical_nonconformances),
            },
          ]}
        />
      )}
    </div>
  );
}
