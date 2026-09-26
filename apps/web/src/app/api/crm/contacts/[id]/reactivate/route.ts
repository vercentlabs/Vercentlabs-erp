import { reactivateCrmContact } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsManage, billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const body = (await readJson(request).catch(() => ({}))) as { expectedUpdatedAt?: string };
    const record = await reactivateCrmContact(client, crmContext(session), id, { expectedUpdatedAt: body.expectedUpdatedAt, requireVersion: true });
    return ok({ record });
  });
}
