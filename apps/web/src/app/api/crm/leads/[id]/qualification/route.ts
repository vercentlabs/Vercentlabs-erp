import { assertSameOriginOrMobile, decideLeadQualification, getLeadQualification } from "@vercentlabs/api";

import { tenantTransaction, withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext } from "@/features/crm/shared/crm-context";

// F006 qualification is a fully governed, independent axis from pipeline
// stage (F007) and record status — decideLeadQualification (lead-
// qualification.js) owns readiness criteria, override policy and history;
// this route never re-derives any of that.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const qualification = await withClient((client) => getLeadQualification(client, crmContext(session), id));
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
    const result = await tenantTransaction(session.organizationId, (client) =>
      decideLeadQualification(client, crmContext(session), id, input),
    );
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
