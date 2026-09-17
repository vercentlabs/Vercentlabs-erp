"use client";

import { useMemo, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, GripVertical, Users } from "lucide-react";
import { Badge, Button, Dialog, Select, type SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getLeadStageReasons, getLeadTransitionGraph, LeadApiError, transitionLeadStage } from "../api/leads-api";
import type { Lead } from "../types";

export type LeadStageOption = { id: string; code: string; name: string };

const priorityTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  urgent: "danger",
};

const DRAG_MIME = "application/x-vercentlabs-lead-id";

function leadDisplayName(lead: Lead) {
  return lead.fullName || `${lead.firstName} ${lead.lastName || ""}`.trim();
}

function ReasonPromptDialog({
  lead,
  stage,
  isPending,
  onCancel,
  onConfirm,
}: {
  lead: Lead;
  stage: LeadStageOption;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: (reasonCode: string) => void;
}) {
  const [reasonCode, setReasonCode] = useState("");
  const reasonsQuery = useQuery({
    queryKey: ["crm", "leads", lead.id, "stage-reasons", stage.id],
    queryFn: () => getLeadStageReasons(lead.id, stage.id),
  });
  const reasonOptions: SelectOption[] = (reasonsQuery.data?.reasons ?? []).map((r) => ({ value: r.code, label: r.label }));

  return (
    <Dialog isOpen title={`Move ${leadDisplayName(lead)} to ${stage.name}`} onOpenChange={(open) => !open && onCancel()}>
      <div className="flex flex-col gap-4">
        <Select
          aria-label="Reason for this move"
          label="Reason"
          options={reasonOptions}
          selectedKey={reasonCode}
          onSelectionChange={(key) => setReasonCode(String(key ?? ""))}
          placeholder={reasonsQuery.isLoading ? "Loading reasons…" : "Choose a reason…"}
          isDisabled={reasonsQuery.isLoading}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onCancel} isDisabled={isPending}>
            Cancel
          </Button>
          <Button variant="primary" onPress={() => reasonCode && onConfirm(reasonCode)} isDisabled={!reasonCode} isLoading={isPending}>
            Move
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function LeadKanbanCard({
  lead,
  stages,
  isPending,
  error,
  onOpen,
  onRequestMove,
  onDragStart,
  onDragEnd,
}: {
  lead: Lead;
  stages: LeadStageOption[];
  isPending: boolean;
  error?: string;
  onOpen: (id: string) => void;
  onRequestMove: (lead: Lead, targetStageId: string) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, lead: Lead) => void;
  onDragEnd: () => void;
}) {
  const [targetStageId, setTargetStageId] = useState("");
  const displayName = leadDisplayName(lead);

  return (
    <div
      draggable={!isPending}
      onDragStart={(event) => onDragStart(event, lead)}
      onDragEnd={onDragEnd}
      className="flex cursor-grab flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-3 shadow-[var(--shadow-subtle)] active:cursor-grabbing"
    >
      <div className="flex items-start gap-1.5">
        <GripVertical className="mt-0.5 size-3.5 shrink-0 text-text-muted" aria-hidden="true" />
        <button type="button" className="text-left text-sm font-medium text-text hover:underline" onClick={() => onOpen(lead.id)}>
          {displayName}
        </button>
      </div>
      {lead.companyName && <span className="pl-5 text-xs text-text-muted">{lead.companyName}</span>}
      <div className="flex flex-wrap items-center gap-1.5 pl-5">
        <Badge tone={priorityTone[lead.priority] ?? "neutral"}>{lead.priority}</Badge>
        {lead.score !== null && <span className="text-xs tabular-nums text-text-muted">Score {lead.score}</span>}
      </div>
      <div className="flex items-center gap-1.5 pl-5 text-xs text-text-muted">
        <Users className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{lead.ownerName || "Unassigned"}</span>
      </div>
      {error && (
        <p role="alert" className="pl-5 text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center gap-1.5 pl-5">
        <Select
          aria-label={`Move ${displayName} to stage`}
          size="compact"
          options={stages.filter((s) => s.code !== lead.status).map((s) => ({ value: s.id, label: s.name }))}
          selectedKey={targetStageId}
          onSelectionChange={(key) => setTargetStageId(String(key ?? ""))}
          placeholder="Move to…"
          className="flex-1"
        />
        <Button
          variant="ghost"
          size="compact"
          aria-label={`Confirm move for ${displayName}`}
          isDisabled={!targetStageId}
          isLoading={isPending}
          onPress={() => {
            if (!targetStageId) return;
            onRequestMove(lead, targetStageId);
            setTargetStageId("");
          }}
        >
          <CheckCircle2 className="size-4" aria-hidden="true" />
        </Button>
      </div>
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
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [draggingLeadId, setDraggingLeadId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);
  const [pendingLeadId, setPendingLeadId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<{ leadId: string; message: string } | null>(null);
  const [reasonPrompt, setReasonPrompt] = useState<{ lead: Lead; stage: LeadStageOption } | null>(null);

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

  const moveMutation = useMutation({
    mutationFn: ({ leadId, stageId, reasonCode, expectedUpdatedAt }: { leadId: string; stageId: string; reasonCode?: string; expectedUpdatedAt: string }) =>
      transitionLeadStage(leadId, { stageId, reasonCode, expectedUpdatedAt }),
    onMutate: ({ leadId }) => {
      setPendingLeadId(leadId);
      setMoveError(null);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads") });
    },
    onError: (err: unknown, variables) => {
      setMoveError({
        leadId: variables.leadId,
        message: err instanceof LeadApiError ? err.message : "This move could not be completed.",
      });
    },
    onSettled: () => setPendingLeadId(null),
  });

  function isReasonRequired(fromStageCode: string, toStageId: string) {
    return transitions.some((edge) => edge.fromStageCode === fromStageCode && edge.toStageId === toStageId && edge.reasonRequired);
  }

  function attemptMove(lead: Lead, targetStageId: string) {
    const targetStage = stages.find((s) => s.id === targetStageId);
    if (!targetStage || targetStage.code === lead.status) return;
    if (isReasonRequired(lead.status, targetStageId)) {
      setReasonPrompt({ lead, stage: targetStage });
      return;
    }
    moveMutation.mutate({ leadId: lead.id, stageId: targetStageId, expectedUpdatedAt: lead.updatedAt });
  }

  function handleDragStart(event: DragEvent<HTMLDivElement>, lead: Lead) {
    event.dataTransfer.setData(DRAG_MIME, lead.id);
    event.dataTransfer.effectAllowed = "move";
    // Without an explicit drag image, the browser falls back to snapshotting
    // the draggable element in whatever ambiguous way it sees fit — inside
    // this flex/overflow-x-auto board layout that produced a huge, blurry
    // ghost covering unrelated columns instead of just the one card. Pinning
    // it to exactly this card, at the cursor's offset within it, forces a
    // clean single-card preview every time.
    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    event.dataTransfer.setDragImage(card, event.clientX - rect.left, event.clientY - rect.top);
    setDraggingLeadId(lead.id);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, stage: LeadStageOption) {
    event.preventDefault();
    setDragOverStageId(null);
    const leadId = event.dataTransfer.getData(DRAG_MIME);
    const lead = leads.find((l) => l.id === leadId);
    setDraggingLeadId(null);
    if (!lead) return;
    attemptMove(lead, stage.id);
  }

  if (isLoading) {
    return <p className="px-1 text-sm text-text-secondary">Loading pipeline…</p>;
  }

  return (
    <>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {stages.map((stage) => {
          const cards = leadsByStage.get(stage.code) ?? [];
          const isDragTarget = dragOverStageId === stage.id && draggingLeadId;
          return (
            <div
              key={stage.id}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragOverStageId(stage.id);
              }}
              onDragLeave={() => setDragOverStageId((id) => (id === stage.id ? null : id))}
              onDrop={(event) => handleDrop(event, stage)}
              className={`flex w-72 shrink-0 flex-col gap-2 rounded-[var(--radius-card)] border p-3 transition-colors ${
                isDragTarget ? "border-brand bg-brand-soft/40" : "border-border bg-surface-muted"
              }`}
            >
              <div className="flex items-center justify-between px-0.5">
                <p className="text-sm font-semibold text-text">{stage.name}</p>
                <span className="text-xs tabular-nums text-text-muted">{cards.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {cards.map((lead) => (
                  <LeadKanbanCard
                    key={lead.id}
                    lead={lead}
                    stages={stages}
                    isPending={pendingLeadId === lead.id}
                    error={moveError?.leadId === lead.id ? moveError.message : undefined}
                    onOpen={onOpen}
                    onRequestMove={attemptMove}
                    onDragStart={handleDragStart}
                    onDragEnd={() => setDraggingLeadId(null)}
                  />
                ))}
                {cards.length === 0 && <p className="px-0.5 text-xs text-text-muted">No leads in this stage.</p>}
              </div>
            </div>
          );
        })}
      </div>
      {reasonPrompt && (
        <ReasonPromptDialog
          lead={reasonPrompt.lead}
          stage={reasonPrompt.stage}
          isPending={moveMutation.isPending}
          onCancel={() => setReasonPrompt(null)}
          onConfirm={(reasonCode) => {
            moveMutation.mutate(
              { leadId: reasonPrompt.lead.id, stageId: reasonPrompt.stage.id, reasonCode, expectedUpdatedAt: reasonPrompt.lead.updatedAt },
              { onSuccess: () => setReasonPrompt(null) },
            );
          }}
        />
      )}
    </>
  );
}
