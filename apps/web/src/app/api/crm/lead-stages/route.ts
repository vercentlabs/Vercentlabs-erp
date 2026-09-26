import { createLeadStage, listLeadStages } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F007 Tranche I (Stage A). listLeadStages/createLeadStage/updateLeadStage/
// reactivateLeadStage/deactivateLeadStageWithMigration (stage-catalog.js /
// stage-migration.js) already governed the real Lead lifecycle catalog
// (the SAME crm_lead_stages the Lead 360's own "Move to stage" UI already
// reads via /api/crm/leads/transition-graph) with zero setup UI before
// this pass. No internal permission check in these functions (unlike
// model-config.js's assertConfigPermission) — gated explicitly here,
// matching the F005 assignment-policy route convention.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? undefined;
    const result = await listLeadStages(client, crmContext(session), { status });
    return ok(result);
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session }) => {
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await createLeadStage(client, crmContext(session), input);
    return ok({ record }, 201);
  });
}
