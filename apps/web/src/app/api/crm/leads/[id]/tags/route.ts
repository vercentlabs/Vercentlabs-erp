import { assertSameOriginOrMobile, assignRecordTag, listRecordTags } from "@vercentlabs/api";

import { tenantTransaction, withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F028 Tranche C. Module-access-only at the route: the real gates are
// inside assignRecordTag/listRecordTags themselves — resolveCrmEntityAccess
// for parent-record visibility, crm.leads.manage for the mutation, same
// layering as Notes/Attachments/Custom fields.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const rows = await withClient(async (client) => {
      await requireCrmAccess(client, session);
      return listRecordTags(client, crmContext(session), "lead", id);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const body = (await readJson(request)) as { tagId?: string };
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return assignRecordTag(client, crmContext(session), "lead", id, String(body.tagId || ""));
    });
    return ok({ rows }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
