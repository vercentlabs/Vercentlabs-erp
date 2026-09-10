import { notFound } from "next/navigation";
import { listCrmRecords } from "@vercentlabs/api";

import LostReasonsWorkspace from "@/modules/crm/opportunity-and-pipeline-governance/lost-reasons-workspace";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";

export const dynamic = "force-dynamic";

export default async function LostReasonsPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();
  const context = await crmApiContext(session);
  const canManage = hasPermission(session, PERMISSIONS.crmSettingsManage);

  const { rows } = await tenantTransaction(context.organizationId, (client) =>
    listCrmRecords(client, context, "lost-reasons", { status: "all", limit: 200 }),
  );

  return (
    <LostReasonsWorkspace
      canManage={canManage}
      reasons={JSON.parse(JSON.stringify(rows)) as Array<{
        id: string;
        name: string;
        code: string;
        category: string | null;
        outcomeType: "won" | "lost" | "both";
        sequence: number;
        status: "active" | "inactive";
        updatedAt: string;
      }>}
    />
  );
}
