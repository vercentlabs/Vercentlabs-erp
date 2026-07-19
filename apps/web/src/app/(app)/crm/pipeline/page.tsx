import { notFound } from "next/navigation";
import { getCrmOptions, listCrmRecords } from "@vercent/api";
import CrmPipelineBoard from "@/components/crm-pipeline-board";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
export const metadata = { title: "CRM pipeline" };
export const dynamic = "force-dynamic";
export default async function PipelinePage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) return notFound();
  const context = crmContext(session);
  const data = await tenantTransaction(
    context.organizationId,
    async (client) => ({
      options: await getCrmOptions(client, context),
      opportunities: await listCrmRecords(client, context, "opportunities", {
        limit: 500,
        status: "all",
      }),
    }),
  );
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Revenue execution</p>
          <h1>Opportunity pipeline</h1>
          <p>
            Move opportunities through governed stages while probability,
            forecasts and stage history remain synchronized.
          </p>
        </div>
        <span className="status-badge neutral">Kanban and table views</span>
      </section>
      <CrmPipelineBoard
        stages={JSON.parse(JSON.stringify(data.options.stages))}
        opportunities={JSON.parse(JSON.stringify(data.opportunities.rows))}
        canManage={hasPermission(session, PERMISSIONS.crmOpportunitiesManage)}
      />
    </>
  );
}
