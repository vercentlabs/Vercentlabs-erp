import { assertSameOriginOrMobile, listDuplicateRules, upsertDuplicateRule } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F008 gap-closure — duplicate-rules.js (upsertDuplicateRule/
// listDuplicateRules/setDuplicateRuleEnabled) checks no permission
// internally (unlike lead-scoring-models' model-config.js), so this route
// enforces crm.data-quality.manage itself, matching the same permission
// the merge/override actions elsewhere in F008 already require.
export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const entityType = new URL(request.url).searchParams.get("entityType");
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.dataQualityManage);
      return listDuplicateRules(client, crmContext(session), entityType || null);
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
      await requireCrmAccess(client, session, CRM_PERMISSIONS.dataQualityManage, { mutation: true });
      return upsertDuplicateRule(client, crmContext(session), input);
    });
    return ok({ record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
