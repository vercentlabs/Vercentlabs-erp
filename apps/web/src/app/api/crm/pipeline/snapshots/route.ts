import { assertSameOriginOrMobile, capturePipelineSnapshots, listPipelineSnapshots } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

function camelize(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase()), value]));
}

// F010 gap-closure — capturePipelineSnapshots has run daily via the worker
// (crm-pipeline-snapshot-capture.js) since it shipped, and listPipelineSnapshots
// already enforces its own manager-level permission check, but neither had
// a route: the history accumulated with no way for anyone to ever see it,
// and the function's own documented "manual" capture mode (for a before/
// after pipeline-review snapshot) had no way to be triggered on demand.
export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const pipelineId = url.searchParams.get("pipelineId") || undefined;
    const limit = url.searchParams.get("limit");
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return listPipelineSnapshots(client, crmContext(session), { pipelineId, limit: limit ? Number(limit) : undefined });
    });
    return ok({ rows: rows.map(camelize) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const body = (await readJson(request)) as { pipelineId?: string };
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.opportunitiesManage, { mutation: true });
      return capturePipelineSnapshots(client, crmContext(session), {
        source: "manual",
        capturedBy: session.userId,
        pipelineId: body.pipelineId,
      });
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
