import { assertSameOriginOrMobile, createLeadStage, listLeadStages } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction, withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F007 Tranche I (Stage A). listLeadStages/createLeadStage/updateLeadStage/
// reactivateLeadStage/deactivateLeadStageWithMigration (stage-catalog.js /
// stage-migration.js) already governed the real Lead lifecycle catalog
// (the SAME crm_lead_stages the Lead 360's own "Move to stage" UI already
// reads via /api/crm/leads/transition-graph) with zero setup UI before
// this pass. No internal permission check in these functions (unlike
// model-config.js's assertConfigPermission) — gated explicitly here,
// matching the F005 assignment-policy route convention.
export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? undefined;
    const result = await withClient(async (client) => {
      await requireCrmAccess(client, session);
      return listLeadStages(client, crmContext(session), { status });
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage);
      return createLeadStage(client, crmContext(session), input);
    });
    return ok({ record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
