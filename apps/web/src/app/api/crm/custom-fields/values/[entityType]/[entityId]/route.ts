import { getCustomFieldValues, setCustomFieldValues } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// Module-access-only, matching Notes/Attachments' own model — the real
// authorization is resolveCrmEntityAccess (parent-record access), called
// inside getCustomFieldValues/setCustomFieldValues themselves, not a
// blanket organizational "manage" permission.
export async function GET(request: Request, context: { params: Promise<{ entityType: string; entityId: string }> }) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { entityType, entityId } = await context.params;
    const rows = await getCustomFieldValues(client, crmContext(session), entityType as never, entityId);
    return ok({ rows });
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ entityType: string; entityId: string }> }) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    const { entityType, entityId } = await context.params;
    const body = (await readJson(request)) as { values?: Record<string, unknown> };
    const rows = await setCustomFieldValues(client, crmContext(session), entityType as never, entityId, body.values ?? {});
    return ok({ rows });
  });
}
