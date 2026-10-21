import { previewBroadcastAudience } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Body: { audience, filters? } — who a WhatsApp broadcast would reach.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => {
    const body = await readBody(request);
    return ok({ preview: await previewBroadcastAudience(client, crmContext(session, snapshot), { audience: String(body.audience ?? ""), filters: (body.filters ?? {}) as Record<string, unknown> }) });
  });
}
