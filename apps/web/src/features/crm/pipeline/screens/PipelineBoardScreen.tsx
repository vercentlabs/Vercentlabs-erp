"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Kanban, MoreHorizontal, Table2 } from "lucide-react";
import { Button, Dialog, ErrorState, IconButton, Menu, MenuItem, MenuTrigger, PageHeader, Select, type SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { listOpportunities, moveOpportunityStage, OpportunityApiError } from "@/features/crm/opportunities/api/opportunities-api";
import type { CrmListResponse, Opportunity } from "@/features/crm/opportunities/types";
import { toNumber } from "@/features/crm/shared/format";
import { dueState, formatDate, formatMoney } from "@/features/crm/shared/human";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";
import { ViewToggle } from "@/features/crm/shared/ui/ViewToggle";

type Stage = { id: string; name: string; sequence: number; pipelineId: string; probability: number; isWon: boolean; isLost: boolean };
type Move = { opportunity: Opportunity; stage: Stage };

const STALE_DAYS = 30;
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

export function PipelineBoardScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const [pipelineId, setPipelineId] = useState<string>("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [outcomeMove, setOutcomeMove] = useState<Move | null>(null);
  const [outcomeReasonId, setOutcomeReasonId] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });

  const pipelineOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.pipelines ?? [];
    return rows.map((row) => ({ value: String(row.id), label: String(row.name) }));
  }, [optionsQuery.data]);
  const activePipelineId = pipelineId || pipelineOptions[0]?.value || "";

  const stages: Stage[] = useMemo(() => {
    const rows = (optionsQuery.data?.options?.stages ?? []) as Stage[];
    return rows.filter((row) => row.pipelineId === activePipelineId).sort((a, b) => a.sequence - b.sequence);
  }, [optionsQuery.data, activePipelineId]);

  const lostReasonOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.lostReasons ?? [];
    return rows.map((row) => ({ value: String(row.id), label: String(row.name) }));
  }, [optionsQuery.data]);

  const boardKey = scopedQueryKey(workspace, "crm", "opportunities", "pipeline", activePipelineId);
  const opportunitiesQuery = useQuery({
    queryKey: boardKey,
    queryFn: () => listOpportunities({ pipelineId: activePipelineId, status: "open", limit: 200 }),
    enabled: Boolean(activePipelineId),
  });

  // The card moves the moment it is dropped; if the server refuses, it goes back and the reason is shown.
  const moveMutation = useMutation({
    mutationFn: ({ opportunity, stage, reasonId }: Move & { reasonId: string | null }) =>
      moveOpportunityStage(opportunity.id, { stageId: stage.id, expectedUpdatedAt: opportunity.updatedAt, expectedStageId: opportunity.stageId, outcomeReasonId: reasonId }),
    onMutate: async ({ opportunity, stage }) => {
      await queryClient.cancelQueries({ queryKey: boardKey });
      const previous = queryClient.getQueryData<CrmListResponse<Opportunity>>(boardKey);
      if (previous) {
        const closing = stage.isWon || stage.isLost;
        queryClient.setQueryData<CrmListResponse<Opportunity>>(boardKey, {
          ...previous,
          rows: closing ? previous.rows.filter((r) => r.id !== opportunity.id) : previous.rows.map((r) => (r.id === opportunity.id ? { ...r, stageId: stage.id, stageName: stage.name } : r)),
        });
      }
      return { previous };
    },
    onSuccess: (_result, { opportunity, stage }) => {
      setActionError(null);
      setNotice(`${opportunity.name} moved to ${stage.name}.`);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunities") });
    },
    onError: (error: unknown, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(boardKey, context.previous);
      setNotice(null);
      setActionError(error instanceof OpportunityApiError ? `Could not move the deal: ${error.message}` : "Could not move the deal. It is back where it was.");
    },
  });

  function requestMove(opportunity: Opportunity, stage: Stage) {
    if (opportunity.stageId === stage.id) return;
    if (stage.isWon || stage.isLost) {
      setOutcomeMove({ opportunity, stage });
      setOutcomeReasonId("");
      return;
    }
    moveMutation.mutate({ opportunity, stage, reasonId: null });
  }

  const opportunitiesByStage = useMemo(() => {
    const map = new Map<string, Opportunity[]>();
    for (const row of opportunitiesQuery.data?.rows ?? []) {
      const list = map.get(row.stageId) ?? [];
      list.push(row);
      map.set(row.stageId, list);
    }
    return map;
  }, [opportunitiesQuery.data]);

  if (optionsQuery.isError) return <ErrorState title="Could not load pipeline configuration" action={{ label: "Retry", onPress: () => optionsQuery.refetch() }} />;

  const dragged = dragId ? (opportunitiesQuery.data?.rows ?? []).find((r) => r.id === dragId) : null;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader
        title="Pipeline"
        description="Open opportunities by stage. Drag a card to another stage, or use its menu to move it with the keyboard."
        secondaryActions={
          <ViewToggle
            options={[{ id: "table", label: "Table", icon: <Table2 className="size-3.5" aria-hidden="true" /> }, { id: "board", label: "Board", icon: <Kanban className="size-3.5" aria-hidden="true" /> }]}
            value="board"
            onChange={(id) => { if (id === "table") router.push("/crm/opportunities"); }}
          />
        }
      />
      <Select aria-label="Pipeline" options={pipelineOptions} selectedKey={activePipelineId} onSelectionChange={(key) => setPipelineId(String(key ?? ""))} className="max-w-[280px]" />
      {actionError && <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{actionError}</p>}
      {notice && <p role="status" className="rounded-[var(--radius-control)] border border-success-emphasis/30 bg-success-soft px-3 py-2 text-sm text-success">{notice}</p>}

      {opportunitiesQuery.isLoading ? (
        <LoadingState label="Loading pipeline" rows={4} onRetry={() => opportunitiesQuery.refetch()} />
      ) : opportunitiesQuery.isError ? (
        <ErrorState title="Could not load the pipeline" action={{ label: "Retry", onPress: () => opportunitiesQuery.refetch() }} />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4" data-testid="pipeline-board">
          {stages.map((stage) => {
            const cards = opportunitiesByStage.get(stage.id) ?? [];
            const total = cards.reduce((sum, card) => sum + toNumber(card.amount), 0);
            const currency = cards[0]?.currencyCode ?? null;
            const isTarget = overStage === stage.id && dragged && dragged.stageId !== stage.id;
            return (
              <section
                key={stage.id}
                aria-label={`${stage.name} stage`}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverStage(stage.id); } }}
                onDragLeave={() => setOverStage((c) => (c === stage.id ? null : c))}
                onDrop={(e) => { e.preventDefault(); setOverStage(null); if (dragged) requestMove(dragged, stage); setDragId(null); }}
                className={`flex w-72 shrink-0 flex-col gap-2 rounded-[var(--radius-card)] border p-3 ${isTarget ? "border-brand bg-brand-soft" : "border-border bg-surface-muted"}`}
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-text">{stage.name}</h2>
                  <span className="text-xs tabular-nums text-text-muted">{cards.length}</span>
                </div>
                <p className="text-xs tabular-nums text-text-muted">{total ? formatMoney(currency, total) : `${Math.round(Number(stage.probability))}% likely`}</p>
                <ul className="flex flex-col gap-2">
                  {cards.map((card) => {
                    const overdue = dueState(card.expectedCloseDate) === "overdue";
                    const idle = daysSince(card.updatedAt);
                    const stale = idle >= STALE_DAYS;
                    return (
                      <li
                        key={card.id}
                        draggable
                        onDragStart={(e) => { setDragId(card.id); e.dataTransfer.effectAllowed = "move"; }}
                        onDragEnd={() => { setDragId(null); setOverStage(null); }}
                        className={`flex cursor-grab flex-col gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface p-2.5 ${dragId === card.id ? "opacity-50" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <button type="button" className="text-left text-sm font-medium text-text hover:underline" onClick={() => router.push(`/crm/opportunities/${card.id}`)}>
                            {card.name}
                          </button>
                          <MenuTrigger>
                            <IconButton aria-label={`Move ${card.name} to another stage`} size="compact">
                              <MoreHorizontal className="size-4" aria-hidden="true" />
                            </IconButton>
                            <Menu onAction={(key) => { const target = stages.find((s) => s.id === String(key)); if (target) requestMove(card, target); }}>
                              {stages.filter((s) => s.id !== card.stageId).map((s) => <MenuItem key={s.id} id={s.id}>{`Move to ${s.name}`}</MenuItem>)}
                            </Menu>
                          </MenuTrigger>
                        </div>
                        <span className="text-xs text-text-secondary">{card.partyName || "No account"}</span>
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="font-semibold tabular-nums text-text">{card.amount !== null ? formatMoney(card.currencyCode, card.amount) : "No amount"}</span>
                          {card.probability !== null && <span className="tabular-nums text-text-muted">{`${Number(card.probability)}%`}</span>}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-muted">
                          {card.ownerName && <span>{card.ownerName}</span>}
                          {card.expectedCloseDate && <span className={overdue ? "font-medium text-danger" : ""}>{overdue ? `⚠ Overdue ${formatDate(card.expectedCloseDate)}` : `Close ${formatDate(card.expectedCloseDate)}`}</span>}
                          {stale && <span className="font-medium text-warning">{`Idle ${idle} days`}</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {cards.length === 0 && <p className="text-xs text-text-muted">{dragId ? "Drop here to move the deal." : "Nothing in this stage."}</p>}
              </section>
            );
          })}
        </div>
      )}

      {outcomeMove && (
        <Dialog isOpen onOpenChange={(open) => { if (!open) setOutcomeMove(null); }} title={`Move to ${outcomeMove.stage.name}`} description={`${outcomeMove.opportunity.name} will leave the open pipeline. Choose the reason so reporting stays accurate.`} size="sm">
          {({ close }) => (
            <div className="flex flex-col gap-4">
              <Select label="Reason" options={lostReasonOptions} selectedKey={outcomeReasonId} onSelectionChange={(key) => setOutcomeReasonId(String(key ?? ""))} placeholder="Choose a reason" />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onPress={close}>Cancel</Button>
                <Button variant="primary" isDisabled={!outcomeReasonId} isLoading={moveMutation.isPending} onPress={() => { const m = outcomeMove; close(); moveMutation.mutate({ ...m, reasonId: outcomeReasonId }); }}>Move deal</Button>
              </div>
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}
