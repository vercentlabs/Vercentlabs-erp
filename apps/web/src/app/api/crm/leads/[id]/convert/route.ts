import { convertCrmLead } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F022 lead-to-opportunity conversion. Idempotency/duplicate-reuse and
// what-gets-created-vs-reused is entirely convertCrmLead's authority
// (services/api/src/modules/crm/crm-conversion-and-sales-handoff/
// lead-conversion.js, covered by crm-lead-conversion-f022.test.mjs and
// crm-lead-conversion-duplicate-reuse-f022.test.mjs) — this route never
// re-derives any of that. convertCrmLead does not check a permission
// internally, so this route enforces crm.leads.manage itself.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsManage, billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = (await readJson(request).catch(() => ({}))) as Record<string, unknown>;
    const result = await convertCrmLead(client, crmContext(session), id, input);
    return ok({ result });
  });
}
