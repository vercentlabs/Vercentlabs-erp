import { notFound } from "next/navigation";
import { listLeadScoringModels } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { crmApiContext } from "@/modules/crm";
import LeadScoringWorkspace from "@/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-scoring-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lead scoring" };

export default async function LeadScoringPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmSettingsManage)) notFound();
  const context = await crmApiContext(session);
  const models = await tenantTransaction(context.organizationId, (client) => listLeadScoringModels(client, context));
  return <LeadScoringWorkspace models={JSON.parse(JSON.stringify(models))} />;
}
