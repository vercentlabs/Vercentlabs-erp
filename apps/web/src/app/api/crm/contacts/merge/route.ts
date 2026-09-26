import { mergeContactsGoverned } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsManage, billingWrite: true }, async ({ client, session }) => {
    const body = (await readJson(request)) as {
      sourceId?: string;
      survivorId?: string;
      reason?: string | null;
      fieldSelections?: Record<string, "source" | "survivor">;
      expectedSourceUpdatedAt?: string;
      expectedSurvivorUpdatedAt?: string;
    };
    if (!body.sourceId || !body.survivorId) throw new HttpError(400, "Both sourceId and survivorId are required.");
    const record = await mergeContactsGoverned(client, crmContext(session), body.sourceId!, body.survivorId!, body.reason ?? null, {
      fieldSelections: body.fieldSelections,
      expectedSourceUpdatedAt: body.expectedSourceUpdatedAt,
      expectedSurvivorUpdatedAt: body.expectedSurvivorUpdatedAt,
    });
    return ok({ record });
  });
}
