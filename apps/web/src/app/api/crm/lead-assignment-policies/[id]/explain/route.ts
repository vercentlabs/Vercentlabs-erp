import { explainLeadAssignmentCandidates, listLeadAssignmentPolicies } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ id: string }> };

// F005 Stage A2 §3. explainLeadAssignmentCandidates (eligibility.js) was
// already used internally by resolveLeadAssignment for round_robin/
// workload owner selection — F005-CAP-001's own canonical sentence is
// "route a lead to the best eligible owner AND EXPLAIN WHY that owner
// won," so this is the feature's own primary, non-boilerplate mandate,
// not an optional add-on. It IS already exported at the package level
// (lead-governance.js re-exports assignment/index.js, which the
// top-level index.js re-exports) — the prior pass's "not even exported"
// claim was wrong, matching the same two-tier-export confusion found
// and corrected earlier this session for F012/F017. Returns per-
// candidate {userId, name, eligible, reasons} — no sensitive data
// beyond a name, already the function's own deliberate design.
export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const url = new URL(request.url);
    const companyId = url.searchParams.get("companyId") || undefined;
    const branchId = url.searchParams.get("branchId") || undefined;
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage);
      // listLeadAssignmentPolicies returns RAW snake_case rows (assignment-
      // engine.js does not camelize — confirmed this session, see
      // features/crm/settings/lead-assignment-policies/types.ts's own note).
      const policies = await listLeadAssignmentPolicies(client, crmContext(session));
      const policy = (policies as Array<Record<string, unknown>>).find((row) => row.id === id);
      if (!policy) throw new HttpError(404, "Assignment rule not found.");
      const memberUserIds: string[] =
        policy.mode === "fixed"
          ? [policy.assignee_user_id].filter((value): value is string => typeof value === "string")
          : (policy.member_user_ids as string[] | undefined) || [];
      return explainLeadAssignmentCandidates(client, crmContext(session), memberUserIds, { companyId, branchId });
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}
