import { assignRecordTag, listRecordTags } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F028 Tranche C. Module-access-only at the route: the real gates are
// inside assignRecordTag/listRecordTags themselves — resolveCrmEntityAccess
// for parent-record visibility, crm.leads.manage for the mutation, same
// layering as Notes/Attachments/Custom fields.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { id } = await context.params;
    const rows = await listRecordTags(client, crmContext(session), "lead", id);
    return ok({ rows });
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const body = (await readJson(request)) as { tagId?: string };
    const rows = await assignRecordTag(client, crmContext(session), "lead", id, String(body.tagId || ""));
    return ok({ rows }, 201);
  });
}
