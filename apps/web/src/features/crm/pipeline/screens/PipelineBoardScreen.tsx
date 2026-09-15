"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { Button, ErrorState, PageHeader, Select, type SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { listOpportunities, moveOpportunityStage, OpportunityApiError } from "@/features/crm/opportunities/api/opportunities-api";
import type { Opportunity } from "@/features/crm/opportunities/types";

type Stage = { id: string; name: string; sequence: number; pipelineId: string; probability: number };

export function PipelineBoardScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const [pipelineId, setPipelineId] = useState<string>("");
  const [moving, setMoving] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);

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

  const opportunitiesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunities", "pipeline", activePipelineId),
    queryFn: () => listOpportunities({ pipelineId: activePipelineId, status: "open", limit: 200 }),
    enabled: Boolean(activePipelineId),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunities") });
  }

  const moveMutation = useMutation({
    mutationFn: ({ opportunity, stageId }: { opportunity: Opportunity; stageId: string }) =>
      moveOpportunityStage(opportunity.id, { stageId, expectedUpdatedAt: opportunity.updatedAt, expectedStageId: opportunity.stageId }),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (error: unknown) => {
      setActionError(error instanceof OpportunityApiError ? error.message : "This move could not be completed.");
    },
  });

  const opportunitiesByStage = useMemo(() => {
    const map = new Map<string, Opportunity[]>();
    for (const row of opportunitiesQuery.data?.rows ?? []) {
      const list = map.get(row.stageId) ?? [];
      list.push(row);
      map.set(row.stageId, list);
    }
    return map;
  }, [opportunitiesQuery.data]);

  if (optionsQuery.isError) return <ErrorState title="Could not load pipeline configuration" />;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader
        title="Pipeline"
        description="Every open opportunity, by stage. Use “Move to stage…” on a card — no drag required."
        secondaryActions={<Button variant="secondary" onPress={() => router.push("/crm/opportunities")}>List view</Button>}
      />
      <Select aria-label="Pipeline" options={pipelineOptions} selectedKey={activePipelineId} onSelectionChange={(key) => setPipelineId(String(key ?? ""))} className="max-w-[280px]" />
      {actionError && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      )}
      {opportunitiesQuery.isLoading ? (
        <p className="text-sm text-text-secondary">Loading pipeline…</p>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {stages.map((stage) => {
            const cards = opportunitiesByStage.get(stage.id) ?? [];
            const total = cards.reduce((sum, card) => sum + (card.amount ?? 0), 0);
            return (
              <div key={stage.id} className="flex w-72 shrink-0 flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface-muted p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-text">{stage.name}</p>
                  <span className="text-xs tabular-nums text-text-muted">{cards.length}</span>
                </div>
                <p className="text-xs tabular-nums text-text-muted">{total ? total.toLocaleString() : "—"}</p>
                <div className="flex flex-col gap-2">
                  {cards.map((card) => (
                    <div key={card.id} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border bg-surface p-2.5">
                      <button type="button" className="text-left text-sm font-medium text-text hover:underline" onClick={() => router.push(`/crm/opportunities/${card.id}`)}>
                        {card.name}
                      </button>
                      <span className="text-xs text-text-muted">{card.partyName || "—"}{card.amount !== null ? ` · ${card.currencyCode || ""} ${card.amount}` : ""}</span>
                      <div className="flex items-center gap-1.5">
                        <Select
                          aria-label={`Move ${card.name} to stage`}
                          size="compact"
                          options={stages.filter((s) => s.id !== stage.id).map((s) => ({ value: s.id, label: s.name }))}
                          selectedKey={moving[card.id] ?? ""}
                          onSelectionChange={(key) => setMoving((current) => ({ ...current, [card.id]: String(key ?? "") }))}
                          placeholder="Move to…"
                          className="flex-1"
                        />
                        <Button
                          variant="ghost"
                          size="compact"
                          aria-label={`Confirm move for ${card.name}`}
                          isDisabled={!moving[card.id]}
                          isLoading={moveMutation.isPending}
                          onPress={() => moving[card.id] && moveMutation.mutate({ opportunity: card, stageId: moving[card.id] })}
                        >
                          <CheckCircle2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {cards.length === 0 && <p className="text-xs text-text-muted">No opportunities in this stage.</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
