import { assertSameOriginOrMobile, listLeadAssignmentPolicies, saveLeadAssignmentPolicy } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction, withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F005 Tranche I (Stage A). listLeadAssignmentPolicies/saveLeadAssignment-
// Policy (assignment-engine.js) already existed, already governed the
// real assignment engine (lead-governance.js reads from the SAME
// tenant.crm_lead_assignment_policies table), with zero setup UI before
// this pass. Deliberately NOT the generic "assignment-rules" resource
// (tenant.crm_assignment_rules) — that table is a different, unused
// table the real engine never reads; confirmed by grep before wiring
// anything, so as not to build a setup screen for a dead system.
export async function GET() {
  try {
    const session = await requireWorkspace();
    const rows = await withClient(async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage);
      return listLeadAssignmentPolicies(client, crmContext(session));
    });
    return ok({ rows });
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
      return saveLeadAssignmentPolicy(client, crmContext(session), input);
    });
    return ok({ record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
