import {
  listLeadAssignmentPolicies,
  saveLeadAssignmentPolicy,
} from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F005. listLeadAssignmentPolicies/saveLeadAssignmentPolicy
// (assignment-engine.js) govern the real assignment engine
// (tenant.crm_lead_assignment_policies). Deliberately NOT the generic
// "assignment-rules" resource (tenant.crm_assignment_rules) — that table
// is unused; the real engine never reads it.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { module: "crm", permission: CRM_PERMISSIONS.settingsManage },
    async ({ client, session }) => {
      const rows = await listLeadAssignmentPolicies(
        client,
        crmContext(session),
      );
      return ok({ rows });
    },
  );
}

export async function POST(request: Request) {
  return workspaceRoute(
    request,
    {
      module: "crm",
      permission: CRM_PERMISSIONS.settingsManage,
      billingWrite: true,
    },
    async ({ client, session }) => {
      const input = (await readJson(request)) as Record<string, unknown>;
      const record = await saveLeadAssignmentPolicy(
        client,
        crmContext(session),
        input,
      );
      return ok({ record }, 201);
    },
  );
}
