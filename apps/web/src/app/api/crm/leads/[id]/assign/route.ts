import { assignLeadOwner } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const body = (await readJson(request)) as {
      ownerUserId?: string | null;
      reason?: string;
      expectedUpdatedAt?: string;
      override?: boolean;
      overrideReason?: string;
    };
    const result = await assignLeadOwner(client, crmContext(session), id, body.ownerUserId ?? null, {
      reason: body.reason,
      expectedUpdatedAt: body.expectedUpdatedAt,
      requireVersion: true,
      override: body.override,
      overrideReason: body.overrideReason,
    });
    return ok(result);
  });
}
