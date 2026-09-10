import { capturePipelineSnapshots, listPipelineSnapshots } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";

// F010 integrity closeout: historical pipeline snapshots. GET retrieves the
// captured history (listPipelineSnapshots itself also enforces the
// crm.opportunities.manage / organization_owner gate — this route's own
// requirePermissionFromSession is defense-in-depth, not the only check).
// POST is the explicit "manager capture" path (source: "manual") alongside
// the daily scheduled worker tick — see
// services/worker/src/handlers/crm-pipeline-snapshot-capture.js.
export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in to an organisation workspace.");
    requirePermissionFromSession(session, PERMISSIONS.crmOpportunitiesManage);
    const context = await crmApiContext(session);
    const url = new URL(request.url);
    const pipelineId = url.searchParams.get("pipelineId") || undefined;
    const limit = Number(url.searchParams.get("limit") || 30);
    const rows = await tenantTransaction(context.organizationId, (client) =>
      listPipelineSnapshots(client, context, { pipelineId, limit }),
    );
    return ok({ rows });
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in to an organisation workspace.");
    requirePermissionFromSession(session, PERMISSIONS.crmOpportunitiesManage);
    const context = await crmApiContext(session);
    const input = (await readJson(request)) as Record<string, unknown>;
    const pipelineId = String(input.pipelineId || "").trim();
    if (!pipelineId) throw new HttpError(400, "Select a pipeline to capture.");
    const result = await tenantTransaction(context.organizationId, (client) =>
      capturePipelineSnapshots(client, context, {
        pipelineId,
        source: "manual",
        capturedBy: context.userId,
      }),
    );
    return ok({ message: "Pipeline snapshot captured.", result });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
