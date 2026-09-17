"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Users } from "lucide-react";
import { Badge, Button, Select, type SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  getLeadStageReasons,
  getLeadTransitionGraph,
  LeadApiError,
  transitionLeadStage,
  type LeadStageTransitionEdge,
} from "../api/leads-api";
import type { Lead } from "../types";

export type LeadStageOption = { id: string; code: string; name: string };

const priorityTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  urgent: "danger",
};

function LeadKanbanCard({
  lead,
  stages,
  transitions,
  onOpen,
}: {
  lead: Lead;
  stages: LeadStageOption[];
  transitions: LeadStageTransitionEdge[];
  onOpen: (id: string) => void;
}) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [targetStageId, setTargetStageId] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const currentStageCode = lead.status;
  const reasonRequired = useMemo(() => {
    if (!targetStageId) return false;
    return transitions.some(
      (edge) => edge.fromStageCode === currentStageCode && edge.toStageId === targetStageId && edge.reasonRequired,
    );
  }, [targetStageId, transitions, currentStageCode]);

  const reasonsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", lead.id, "stage-reasons", targetStageId),
    queryFn: () => getLeadStageReasons(lead.id, targetStageId),
    enabled: reasonRequired && Boolean(targetStageId),
  });
  const reasonOptions: SelectOption[] = (reasonsQuery.data?.reasons ?? []).map((r) => ({ value: r.code, label: r.label }));

  const moveMutation = useMutation({
    mutationFn: () =>
      transitionLeadStage(lead.id, {
        stageId: targetStageId,
        reasonCode: reasonCode || undefined,
        expectedUpdatedAt: lead.updatedAt,
      }),
    onSuccess: () => {
      setError(null);
      setTargetStageId("");
      setReasonCode("");
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads") });
    },
    onError: (err: unknown) => {
      setError(err instanceof LeadApiError ? err.message : "This move could not be completed.");
    },
  });

  const canConfirm = Boolean(targetStageId) && (!reasonRequired || Boolean(reasonCode));
  const displayName = lead.fullName || `${lead.firstName} ${lead.lastName || ""}`.trim();

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-3 shadow-[var(--shadow-subtle)]">
      <button type="button" className="text-left text-sm font-medium text-text hover:underline" onClick={() => onOpen(lead.id)}>
        {displayName}
      </button>
      {lead.companyName && <span className="text-xs text-text-muted">{lead.companyName}</span>}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={priorityTone[lead.priority] ?? "neutral"}>{lead.priority}</Badge>
        {lead.score !== null && <span className="text-xs tabular-nums text-text-muted">Score {lead.score}</span>}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-text-muted">
        <Users className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{lead.ownerName || "Unassigned"}</span>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center gap-1.5">
        <Select
          aria-label={`Move ${displayName} to stage`}
          size="compact"
          options={stages.filter((s) => s.code !== currentStageCode).map((s) => ({ value: s.id, label: s.name }))}
          selectedKey={targetStageId}
          onSelectionChange={(key) => {
            setTargetStageId(String(key ?? ""));
            setReasonCode("");
          }}
          placeholder="Move to…"
          className="flex-1"
        />
        <Button
          variant="ghost"
          size="compact"
          aria-label={`Confirm move for ${displayName}`}
          isDisabled={!canConfirm}
          isLoading={moveMutation.isPending}
          onPress={() => canConfirm && moveMutation.mutate()}
        >
          <CheckCircle2 className="size-4" aria-hidden="true" />
        </Button>
      </div>
      {reasonRequired && (
        <Select
          aria-label={`Reason for moving ${displayName}`}
          size="compact"
          options={reasonOptions}
          selectedKey={reasonCode}
          onSelectionChange={(key) => setReasonCode(String(key ?? ""))}
          placeholder="Choose a reason…"
        />
      )}
    </div>
  );
}

export function LeadKanbanBoard({
  leads,
  stages,
  isLoading,
  onOpen,
}: {
  leads: Lead[];
  stages: LeadStageOption[];
  isLoading: boolean;
  onOpen: (id: string) => void;
}) {
  const transitionGraphQuery = useQuery({
    queryKey: ["crm", "leads", "transition-graph"],
    queryFn: getLeadTransitionGraph,
  });
  const transitions = transitionGraphQuery.data?.transitions ?? [];

  const leadsByStage = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const lead of leads) {
      const list = map.get(lead.status) ?? [];
      list.push(lead);
      map.set(lead.status, list);
    }
    return map;
  }, [leads]);

  if (isLoading) {
    return <p className="px-1 text-sm text-text-secondary">Loading pipeline…</p>;
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {stages.map((stage) => {
        const cards = leadsByStage.get(stage.code) ?? [];
        return (
          <div key={stage.id} className="flex w-72 shrink-0 flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface-muted p-3">
            <div className="flex items-center justify-between px-0.5">
              <p className="text-sm font-semibold text-text">{stage.name}</p>
              <span className="text-xs tabular-nums text-text-muted">{cards.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {cards.map((lead) => (
                <LeadKanbanCard key={lead.id} lead={lead} stages={stages} transitions={transitions} onOpen={onOpen} />
              ))}
              {cards.length === 0 && <p className="px-0.5 text-xs text-text-muted">No leads in this stage.</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
