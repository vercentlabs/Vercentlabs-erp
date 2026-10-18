import { lookupCompanyByGstin } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// Company lookup from a GSTIN (CRM plan 5.6): what the GST register says, to fill in a new company. ?refresh=1 asks again.
export async function GET(request: Request, { params }: { params: Promise<{ gstin: string }> }) {
  const { gstin } = await params;
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ company: await lookupCompanyByGstin(client, crmContext(session, snapshot), decodeURIComponent(gstin), { refresh }) }));
}
