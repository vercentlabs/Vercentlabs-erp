import { createTag, listTags } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// The organization's tags (?counts=1 adds how many leads and deals carry each).
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ tags: await listTags(client, crmContext(session, snapshot), { withCounts: new URL(request.url).searchParams.get("counts") === "1" }) }));
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session, snapshot }) => {
    const body = await readBody(request);
    return ok({ tag: await createTag(client, crmContext(session, snapshot), { name: String(body.name ?? ""), color: body.color as never }) }, 201);
  });
}
