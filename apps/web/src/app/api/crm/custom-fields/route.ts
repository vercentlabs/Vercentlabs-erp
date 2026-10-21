import { createCustomField, listCustomFields } from "@vercentlabs/api/crm";

import { fail, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Custom fields (CRM plan 5.3): ?entity=lead|opportunity|party|contact; ?all=1 includes switched-off ones (CRM settings managers).
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const entity = params.get("entity") ?? "";
  if (!["lead", "opportunity", "party", "contact"].includes(entity)) return fail("Choose leads, deals, companies or contacts.", 400);
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ fields: await listCustomFields(client, crmContext(session, snapshot), entity, { includeInactive: params.get("all") === "1" }) }));
}

// Body: { entityType, label, type, options?, isRequired?, helpText? }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ field: await createCustomField(client, crmContext(session, snapshot), await readBody(request)) }, 201));
}
