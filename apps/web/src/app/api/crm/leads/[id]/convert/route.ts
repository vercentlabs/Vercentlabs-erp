import { assertSameOriginOrMobile, convertCrmLead } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F022 lead-to-opportunity conversion. Idempotency/duplicate-reuse and
// what-gets-created-vs-reused is entirely convertCrmLead's authority
// (services/api/src/modules/crm/crm-conversion-and-sales-handoff/
// lead-conversion.js, covered by crm-lead-conversion-f022.test.mjs and
// crm-lead-conversion-duplicate-reuse-f022.test.mjs) — this route never
// re-derives any of that. convertCrmLead does not check a permission
// internally, so this route enforces crm.leads.manage itself.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = (await readJson(request).catch(() => ({}))) as Record<string, unknown>;
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.leadsManage);
      return convertCrmLead(client, crmContext(session), id, input);
    });
    return ok({ result });
  } catch (error) {
    return errorResponse(error);
  }
}
