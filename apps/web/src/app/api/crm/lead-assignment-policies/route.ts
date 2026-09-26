import { listLeadAssignmentPolicies, saveLeadAssignmentPolicy } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F005 Tranche I (Stage A). listLeadAssignmentPolicies/saveLeadAssignment-
// Policy (assignment-engine.js) already existed, already governed the
// real assignment engine (lead-governance.js reads from the SAME
// tenant.crm_lead_assignment_policies table), with zero setup UI before
// this pass. Deliberately NOT the generic "assignment-rules" resource
// (tenant.crm_assignment_rules) — that table is a different, unused
// table the real engine never reads; confirmed by grep before wiring
// anything, so as not to build a setup screen for a dead system.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage }, async ({ client, session }) => {
    const rows = await listLeadAssignmentPolicies(client, crmContext(session));
    return ok({ rows });
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session }) => {
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await saveLeadAssignmentPolicy(client, crmContext(session), input);
    return ok({ record }, 201);
  });
}
