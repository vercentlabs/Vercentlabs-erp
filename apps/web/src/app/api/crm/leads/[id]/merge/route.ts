import { mergeCrmLead } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F008 duplicate merge. `id` is the surviving (target) lead; the
// request body names the source (losing) lead. Survivorship rules are
// mergeCrmLead's authority, not this route's. mergeCrmLead does not check
// a permission internally (unlike dismissLeadDuplicateMatch), so this
// route enforces crm.data-quality.manage itself, matching the permission
// dismissLeadDuplicateMatch's own canOverrideLeadDuplicate requires.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.dataQualityManage, billingWrite: true }, async ({ client, session }) => {
    const { id: targetId } = await context.params;
    const body = (await readJson(request)) as { sourceId: string };
    const result = await mergeCrmLead(client, crmContext(session), body.sourceId, targetId);
    return ok({ result });
  });
}
