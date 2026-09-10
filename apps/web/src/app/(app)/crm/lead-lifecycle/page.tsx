import { notFound } from "next/navigation";
import { listLeadStages, listLeadStageTransitionReasons, listLeadStageTransitions } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { crmApiContext } from "@/modules/crm";
import LeadLifecycleWorkspace from "@/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-lifecycle-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lead lifecycle" };

export default async function LeadLifecyclePage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmSettingsManage)) notFound();
  const context = await crmApiContext(session);
  const [stages, transitions, reasons] = await tenantTransaction(context.organizationId, (client) =>
    Promise.all([
      listLeadStages(client, context, { status: "all" }),
      listLeadStageTransitions(client, context),
      listLeadStageTransitionReasons(client, context),
    ]),
  );
  return (
    <LeadLifecycleWorkspace
      rows={JSON.parse(JSON.stringify(stages.rows))}
      transitions={JSON.parse(JSON.stringify(transitions))}
      reasons={JSON.parse(JSON.stringify(reasons))}
    />
  );
}
