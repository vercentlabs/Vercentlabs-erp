import { assertSameOriginOrMobile, dismissLeadDuplicateMatch } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext } from "@/features/crm/shared/crm-context";

// F008: dismissing a probable-duplicate signal is reasoned and audited,
// never a silent client-side hide — an exact duplicate cannot be
// dismissed at all (dismissLeadDuplicateMatch enforces that itself).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const body = (await readJson(request)) as { matchedLeadId: string; reason: string };
    const result = await tenantTransaction(session.organizationId, (client) =>
      dismissLeadDuplicateMatch(client, crmContext(session), id, body.matchedLeadId, body.reason),
    );
    return ok({ result });
  } catch (error) {
    return errorResponse(error);
  }
}
