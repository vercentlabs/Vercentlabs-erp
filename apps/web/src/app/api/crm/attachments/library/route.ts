import { searchAttachments } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// Files across every record the caller can see: ?search&kind&relatedType&uploadedBy&limit&offset
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.view }, async ({ client, session }) => {
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    return ok(await searchAttachments(client, crmContext(session), { ...params, limit: Number(params.limit) || undefined, offset: Number(params.offset) || undefined }));
  });
}
