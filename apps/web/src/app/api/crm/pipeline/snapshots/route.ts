import { capturePipelineSnapshots, listPipelineSnapshots } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

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
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const pipelineId = url.searchParams.get("pipelineId") || undefined;
    const limit = url.searchParams.get("limit");
    const rows = await listPipelineSnapshots(client, crmContext(session), { pipelineId, limit: limit ? Number(limit) : undefined });
    return ok({ rows: rows.map(camelize) });
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesManage, billingWrite: true }, async ({ client, session }) => {
    const body = (await readJson(request)) as { pipelineId?: string };
    const result = await capturePipelineSnapshots(client, crmContext(session), {
      source: "manual",
      capturedBy: session.userId,
      pipelineId: body.pipelineId,
    });
    return ok(result);
  });
}
