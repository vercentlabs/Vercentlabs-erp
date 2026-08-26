import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrmOptions, listCrmRecords } from "@vercentlabs/api";

import CrmPipelineBoard from "@/modules/crm/components/pipeline-board";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { crmContext } from "@/modules/crm";
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

  const context = crmContext(session);
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

      return {
        pipelines,
        selectedPipelineId,
        stages,
        outcomeReasons,
        opportunities,
      };
    },
  );

  const canManage = hasPermission(
    session,
    PERMISSIONS.crmOpportunitiesManage,
  );

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Revenue execution</p>
          <h1>Opportunity pipeline</h1>
          <p>
            Work one governed pipeline at a time. Stage changes preserve scope,
            concurrency, history, audit and outcome controls.
          </p>
        </div>
        <div className="heading-actions">
          {canManage ? (
            <Link className="primary-button" href="/crm/opportunities?create=1">
              Create opportunity
            </Link>
          ) : null}
          <Link className="secondary-button" href="/crm/opportunities">
            View opportunity table
          </Link>
        </div>
      </section>
      <CrmPipelineBoard
        pipelines={data.pipelines}
        selectedPipelineId={data.selectedPipelineId}
        stages={data.stages}
        outcomeReasons={data.outcomeReasons}
        opportunities={JSON.parse(JSON.stringify(data.opportunities.rows))}
        total={data.opportunities.total}
        canManage={canManage}
      />
    </>
  );
}
