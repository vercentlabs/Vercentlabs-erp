import { applyActivityPlan } from "@vercentlabs/api/crm";

import { fail, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Body: { relatedType: lead | opportunity, relatedId, startDate? } — plans every step of the plan on the record.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) => {
    const body = await readBody(request);
    if (!["lead", "opportunity"].includes(String(body.relatedType))) return fail("Apply a plan to a lead or deal.", 400);
    return ok(await applyActivityPlan(client, crmContext(session, snapshot), id, { relatedType: String(body.relatedType), relatedId: String(body.relatedId ?? ""), startDate: body.startDate ? String(body.startDate) : null }));
  });
}
