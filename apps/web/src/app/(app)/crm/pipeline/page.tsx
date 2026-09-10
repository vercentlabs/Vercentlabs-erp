import { notFound } from "next/navigation";
import { evaluateOpportunityHealth, getCrmOptions, listCrmRecords, listOpportunityStageAges, listOpportunityPipelineStageTotals, listPipelineSnapshots } from "@vercentlabs/api";

import CrmPipelineBoard from "@/modules/crm/opportunity-and-pipeline-governance/pipeline-board";
import PipelineHistoryPanel from "@/modules/crm/opportunity-and-pipeline-governance/pipeline-history-panel";
import { ActionLink, PageHeader } from "@/shared/design";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";

export const metadata = { title: "CRM pipeline" };
export const dynamic = "force-dynamic";

type PipelineSearchParams = Promise<{ pipeline?: string }>;

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: PipelineSearchParams;
}) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) return notFound();
  const canManage = hasPermission(session, PERMISSIONS.crmOpportunitiesManage);

  const context = await crmApiContext(session);
  const requestedPipelineId = String((await searchParams).pipeline || "").trim();
  const data = await tenantTransaction(
    context.organizationId,
    async (client) => {
      const options = await getCrmOptions(client, context);
      const pipelines = (options.pipelines || []).map((pipeline) => ({
        id: String(pipeline.id),
        name: String(pipeline.name),
      }));
      const selectedPipeline =
        pipelines.find((pipeline) => pipeline.id === requestedPipelineId) ||
        pipelines[0] ||
        null;
      const selectedPipelineId = selectedPipeline?.id || null;
      const stages = (options.stages || [])
        .filter(
          (stage) =>
            selectedPipelineId &&
            String(stage.pipelineId) === selectedPipelineId,
        )
        .map((stage) => ({
          id: String(stage.id),
          pipelineId: String(stage.pipelineId),
          name: String(stage.name),
          sequence: Number(stage.sequence || 0),
          probability: Number(stage.probability || 0),
          isWon: Boolean(stage.isWon),
          isLost: Boolean(stage.isLost),
          staleAfterDays: stage.staleAfterDays == null ? null : Number(stage.staleAfterDays),
        }));
      const outcomeReasons = (options.lostReasons || []).map((reason) => ({
        id: String(reason.id),
        name: String(reason.name),
        outcomeType: String(reason.outcomeType || "lost") as
          | "won"
          | "lost"
          | "both",
      }));
      const opportunities = selectedPipelineId
        ? await listCrmRecords(client, context, "opportunities", {
            pipelineId: selectedPipelineId,
            status: "open",
            limit: 500,
          })
        : { rows: [], total: 0, limit: 500, offset: 0 };
      const stageAges = selectedPipelineId
        ? await listOpportunityStageAges(client, context, selectedPipelineId)
        : {};
      // Integrity closeout (Prompts 1-5): an authoritative, unbounded
      // server aggregate — independent of the `limit: 500` capped card
      // list above — so per-stage totals stay correct even when a
      // pipeline holds more than 500 open Opportunities. See
      // stage-aging.js's listOpportunityPipelineStageTotals.
      const stageTotals = selectedPipelineId
        ? await listOpportunityPipelineStageTotals(client, context, selectedPipelineId)
        : {};
      // F010 integrity closeout: recent historical snapshots for the
      // selected pipeline, for authorized managers only — listPipelineSnapshots
      // itself also enforces this same gate; canManage is checked here first
      // purely to avoid the call (and its own permission check) when it
      // cannot possibly succeed.
      const snapshots =
        canManage && selectedPipelineId
          ? await listPipelineSnapshots(client, context, { pipelineId: selectedPipelineId, limit: 60 })
          : [];
      opportunities.rows = opportunities.rows.map((row) => {
        const health = evaluateOpportunityHealth({
          amount: row.amount,
          probability: row.probability,
          expected_close_date: row.expectedCloseDate,
          expected_revenue: row.expectedRevenue,
          last_activity_at: row.lastActivityAt,
          updated_at: row.updatedAt,
          created_at: row.createdAt,
          next_step: row.nextStep,
          status: row.status,
        });
        const stageAge = stageAges[String(row.id)] || null;
        return { ...row, warnings: health.warnings, inactiveDays: health.inactiveDays, stageAgeDays: stageAge?.ageDays ?? null, stageAgeStatus: stageAge?.status ?? "unknown" };
      });

      return {
        pipelines,
        selectedPipelineId,
        stages,
        outcomeReasons,
        opportunities,
        stageTotals,
        snapshots,
      };
    },
  );

  return (
    <>
      <PageHeader
        eyebrow="Revenue execution"
        title="Opportunity pipeline"
        description="Work one governed pipeline at a time. Stage changes preserve scope, concurrency, history, audit and outcome controls."
        actions={
          <>
            {canManage ? (
              <ActionLink tone="primary" href="/crm/opportunities?create=1">
                Create opportunity
              </ActionLink>
            ) : null}
            <ActionLink href="/crm/opportunities">
              View opportunity table
            </ActionLink>
          </>
        }
      />
      <CrmPipelineBoard
        pipelines={data.pipelines}
        selectedPipelineId={data.selectedPipelineId}
        stages={data.stages}
        outcomeReasons={data.outcomeReasons}
        opportunities={JSON.parse(JSON.stringify(data.opportunities.rows))}
        total={data.opportunities.total}
        stageTotals={data.stageTotals}
        canManage={canManage}
      />
      {canManage && data.selectedPipelineId ? (
        <PipelineHistoryPanel
          pipelineId={data.selectedPipelineId}
          stages={data.stages.map((stage) => ({ id: stage.id, name: stage.name }))}
          snapshots={JSON.parse(JSON.stringify(data.snapshots))}
          currentTotals={data.stageTotals}
        />
      ) : null}
    </>
  );
}
