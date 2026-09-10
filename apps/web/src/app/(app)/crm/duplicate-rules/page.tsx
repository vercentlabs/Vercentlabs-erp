import { notFound } from "next/navigation";
import { listDuplicateRules } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { crmApiContext } from "@/modules/crm";
import DuplicateRulesWorkspace from "@/modules/crm/prospect-and-relationship-master-data/duplicate-rules-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Duplicate detection rules" };

export default async function DuplicateRulesPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmSettingsManage)) notFound();
  const context = await crmApiContext(session);
  const rules = await tenantTransaction(context.organizationId, (client) =>
    listDuplicateRules(client, context, null),
  );
  return <DuplicateRulesWorkspace rules={JSON.parse(JSON.stringify(rules))} />;
}
