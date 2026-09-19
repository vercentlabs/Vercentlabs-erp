import { assertSameOriginOrMobile, decideLeadQualification, getLeadQualification } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F006 qualification is a fully governed, independent axis from pipeline
// stage (F007) and record status — decideLeadQualification (lead-
// qualification.js) owns readiness criteria, override policy and history;
// this route never re-derives any of that. decideLeadQualification already
// checks crm.leads.manage internally (assertCanDecide); this route still
// enforces the module-access layer for both GET and POST.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const qualification = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return getLeadQualification(client, crmContext(session), id);
    });
    return ok({ qualification });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, undefined, { mutation: true });
      return decideLeadQualification(client, crmContext(session), id, input);
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
