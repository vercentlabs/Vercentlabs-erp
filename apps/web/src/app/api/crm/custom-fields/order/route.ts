import { reorderCustomFields } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// The order of a record type's custom fields on its forms and pages. Body: { entityType, ids: [field id, ...] }.
export async function PUT(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) => {
    const body = (await readBody(request)) as { entityType?: string; ids?: string[] };
    return ok({ fields: await reorderCustomFields(client, crmContext(session, snapshot), String(body.entityType ?? ""), body.ids ?? []) });
  });
}
