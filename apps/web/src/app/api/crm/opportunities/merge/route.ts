import { mergeOpportunities } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/opportunities/server/opportunity-http";

// Merges two deals of the same company (CRM plan 5.4). Body: { keepId, duplicateId, choices?: { field: "keep" | "duplicate" }, notes? }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView, billingWrite: true }, async ({ client, session, snapshot }) => {
    const body = await readBody(request);
    return ok(await mergeOpportunities(client, crmContext(session, snapshot), {
      keepId: String(body.keepId ?? ""), duplicateId: String(body.duplicateId ?? ""), choices: (body.choices ?? {}) as Record<string, "keep" | "duplicate">,
      notes: body.notes ? String(body.notes) : undefined,
    }));
  });
}
