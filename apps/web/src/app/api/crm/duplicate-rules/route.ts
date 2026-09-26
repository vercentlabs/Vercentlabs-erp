import { listDuplicateRules, upsertDuplicateRule } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F008 gap-closure — duplicate-rules.js (upsertDuplicateRule/
// listDuplicateRules/setDuplicateRuleEnabled) checks no permission
// internally (unlike lead-scoring-models' model-config.js), so this route
// enforces crm.data-quality.manage itself, matching the same permission
// the merge/override actions elsewhere in F008 already require.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.dataQualityManage }, async ({ client, session }) => {
    const entityType = new URL(request.url).searchParams.get("entityType");
    const rows = await listDuplicateRules(client, crmContext(session), entityType || null);
    return ok({ rows });
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.dataQualityManage, billingWrite: true }, async ({ client, session }) => {
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await upsertDuplicateRule(client, crmContext(session), input);
    return ok({ record }, 201);
  });
}
