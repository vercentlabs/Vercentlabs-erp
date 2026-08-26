import { notFound } from "next/navigation";
import { listLeadStages } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { crmApiContext } from "@/modules/crm";
import LeadLifecycleWorkspace from "@/modules/crm/components/lead-lifecycle-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lead lifecycle" };

export default async function LeadLifecyclePage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmSettingsManage)) notFound();
  const context = await crmApiContext(session);
  const result = await tenantTransaction(context.organizationId, (client) =>
    listLeadStages(client, context, { status: "all" }),
  );
  return <LeadLifecycleWorkspace rows={JSON.parse(JSON.stringify(result.rows))} />;
}
