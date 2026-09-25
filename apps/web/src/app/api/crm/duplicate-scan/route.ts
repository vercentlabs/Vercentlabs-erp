import { assertSameOriginOrMobile, enqueueDuplicateFullScan, getLatestDuplicateFullScan } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F008 gap-closure — a genuine full-dataset duplicate scan (background
// job), distinct from the honestly-scoped 40-most-recent-records
// "Suspected duplicates" workspace check. Gated by crm.data-quality.manage,
// the same permission the merge/override actions elsewhere in F008 require.
export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const entityType = new URL(request.url).searchParams.get("entityType") || "";
    const job = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.dataQualityManage);
      return getLatestDuplicateFullScan(client, crmContext(session), entityType);
    });
    return ok({ job });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = (await readJson(request)) as { entityType?: string };
    const job = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.dataQualityManage, { mutation: true });
      return enqueueDuplicateFullScan(client, crmContext(session), input.entityType || "");
    });
    return ok({ job }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
