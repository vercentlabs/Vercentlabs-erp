import { testGstLookup } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Tries the provider entered (saved or not) on one GSTIN: { url?, keyHeader?, apiKey?, gstin }. Nothing is kept.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ result: await testGstLookup(client, crmContext(session, snapshot), await readBody(request)) }));
}
