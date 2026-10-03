import {
  explainLeadAssignmentCandidates,
  listLeadAssignmentPolicies,
} from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string }> };

// F005. explainLeadAssignmentCandidates (eligibility.js), also used by
// resolveLeadAssignment for round_robin/workload owner selection: route a
// lead to the best eligible owner AND explain why that owner won. Exported
// at the package level via lead-governance.js's re-export of
// assignment/index.js. Returns per-
// candidate {userId, name, eligible, reasons} — no sensitive data
// beyond a name, already the function's own deliberate design.
export async function GET(request: Request, context: RouteContext) {
  return workspaceRoute(
    request,
    { module: "crm", permission: CRM_PERMISSIONS.settingsManage },
    async ({ client, session }) => {
      const { id } = await context.params;
      // listLeadAssignmentPolicies returns RAW snake_case rows (assignment-
      // engine.js does not camelize — confirmed this session, see
      // features/crm/setup/lead-assignment-policies/types.ts's own note).
      const policies = await listLeadAssignmentPolicies(
        client,
        crmContext(session),
      );
      const policy = (policies as Array<Record<string, unknown>>).find(
        (row) => row.id === id,
      );
      if (!policy) throw new HttpError(404, "Assignment rule not found.");
      const memberUserIds: string[] =
        policy.mode === "fixed"
          ? [policy.assignee_user_id].filter(
              (value): value is string => typeof value === "string",
            )
          : (policy.member_user_ids as string[] | undefined) || [];
      const rows = await explainLeadAssignmentCandidates(
        client,
        crmContext(session),
        memberUserIds,
      );
      return ok({ rows });
    },
  );
}
