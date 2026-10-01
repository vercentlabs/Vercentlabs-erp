"use client";

import { useQuery } from "@tanstack/react-query";
import { Dialog, StatusBadge } from "@vercentlabs/design-system";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  listStageHistory,
  type StageHistoryEntry,
} from "../api/pipeline-stages-api";

// F012 gap-closure — tenant.crm_sales_stage_configuration_history has
// recorded every created/updated/reordered/deactivated/reactivated action
// with before/after snapshots since it shipped, with zero readers anywhere.
export function StageHistoryDialog({
  pipelineId,
  onOpenChange,
}: {
  pipelineId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const workspace = useWorkspaceContext();
  const historyQuery = useQuery({
    queryKey: scopedQueryKey(
      workspace,
      "crm",
      "pipeline-stages",
      "history",
      pipelineId,
    ),
    queryFn: () => listStageHistory(pipelineId),
  });
  const rows = historyQuery.data?.rows ?? [];

  const actionLabel: Record<StageHistoryEntry["action"], string> = {
    created: "Created",
    updated: "Updated",
    reordered: "Reordered",
    deactivated: "Deactivated",
    reactivated: "Reactivated",
  };

  return (
    <Dialog
      isOpen
      onOpenChange={onOpenChange}
      title="Stage configuration history"
      description="Every change to this pipeline's stages, in one place."
      size="lg"
    >
      {historyQuery.isLoading ? (
        <p className="text-sm text-text-secondary">Loading history…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-muted">
          No configuration changes recorded yet.
        </p>
      ) : (
        <div className="flex max-h-[420px] flex-col divide-y divide-border overflow-y-auto">
          {rows.map((row) => (
            <div key={row.id} className="flex flex-col gap-0.5 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-text">{row.stageName}</span>
                <StatusBadge
                  tone={
                    row.action === "deactivated"
                      ? "danger"
                      : row.action === "reactivated" || row.action === "created"
                        ? "success"
                        : "neutral"
                  }
                >
                  {actionLabel[row.action]}
                </StatusBadge>
                <span className="text-xs text-text-muted">
                  {new Date(row.changedAt).toLocaleString("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              </div>
              <span className="text-xs text-text-secondary">
                {row.changedByName ? `By ${row.changedByName}` : "System"}
              </span>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
