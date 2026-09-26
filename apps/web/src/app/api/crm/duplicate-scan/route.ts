import { enqueueDuplicateFullScan, getLatestDuplicateFullScan } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F008 gap-closure — a genuine full-dataset duplicate scan (background
// job), distinct from the honestly-scoped 40-most-recent-records
// "Suspected duplicates" workspace check. Gated by crm.data-quality.manage,
// the same permission the merge/override actions elsewhere in F008 require.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.dataQualityManage }, async ({ client, session }) => {
    const entityType = new URL(request.url).searchParams.get("entityType") || "";
    const job = await getLatestDuplicateFullScan(client, crmContext(session), entityType);
    return ok({ job });
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.dataQualityManage, billingWrite: true }, async ({ client, session }) => {
    const input = (await readJson(request)) as { entityType?: string };
    const job = await enqueueDuplicateFullScan(client, crmContext(session), input.entityType || "");
    return ok({ job }, 202);
  });
}
