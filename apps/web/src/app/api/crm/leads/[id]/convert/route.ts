import { assertSameOriginOrMobile, convertCrmLead } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext } from "@/features/crm/shared/crm-context";

// F022 lead-to-opportunity conversion. Idempotency/duplicate-reuse and
// what-gets-created-vs-reused is entirely convertCrmLead's authority
// (services/api/src/modules/crm/crm-conversion-and-sales-handoff/
// lead-conversion.js, covered by crm-lead-conversion-f022.test.mjs and
// crm-lead-conversion-duplicate-reuse-f022.test.mjs) — this route never
// re-derives any of that.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = (await readJson(request).catch(() => ({}))) as Record<string, unknown>;
    const result = await tenantTransaction(session.organizationId, (client) =>
      convertCrmLead(client, crmContext(session), id, input),
    );
    return ok({ result });
  } catch (error) {
    return errorResponse(error);
  }
}
