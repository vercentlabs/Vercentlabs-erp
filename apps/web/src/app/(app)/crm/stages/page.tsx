import { notFound } from "next/navigation";
import {
  listSalesStageHistory,
  listSalesStagePipelines,
  listSalesStages,
} from "@vercentlabs/api";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { crmApiContext } from "@/modules/crm";
import SalesStagesWorkspace from "@/modules/crm/opportunity-and-pipeline-governance/sales-stages-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sales stages" };

type SearchParams = Promise<{ pipeline?: string }>;

export default async function SalesStagesPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmSettingsManage)) notFound();
  const context = await crmApiContext(session);
  const requestedPipelineId = String((await searchParams).pipeline || "").trim();
  const data = await tenantTransaction(context.organizationId, async (client) => {
    const pipelines = await listSalesStagePipelines(client, context, { status: "all" });
    const selected = pipelines.find((pipeline) => String(pipeline.id) === requestedPipelineId) || pipelines[0] || null;
    if (!selected) return { pipelines, selectedPipelineId: null, stages: [], history: [] };
    // Sequential, not Promise.all — see the CRM revenue-intelligence fix for
    // why concurrent client.query() on one shared PoolClient is unsafe.
    const stages = await listSalesStages(client, context, { pipelineId: String(selected.id), status: "all" });
    const history = await listSalesStageHistory(client, context, String(selected.id), 50);
    return { pipelines, selectedPipelineId: String(selected.id), stages: stages.rows, history };
  });
  return <SalesStagesWorkspace {...JSON.parse(JSON.stringify(data))} />;
}
