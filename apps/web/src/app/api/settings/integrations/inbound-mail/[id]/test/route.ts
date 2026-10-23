import { sendInboundMailTest } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Send test email: a signed sample message through the same steps as a provider's delivery; it opens a real ticket or lead, named as a test.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.integrationsManage, action: "integrations.inbound_mail.test", auditDenial: true },
    async ({ session }) =>
      ok({ result: await sendInboundMailTest({ runTenant: (organizationId, work) => tenantTransaction(organizationId, work) }, session, id) }),
  );
}
