import { listConsentHistory } from "@vercentlabs/api/crm";

import { fail, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// A lead's or contact's consent history from the ledger (CRM plan 4.3): /api/crm/consent/{leads|contacts}/{id}
const TYPES: Record<string, "lead" | "contact"> = { leads: "lead", contacts: "contact" };

export async function GET(request: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  if (!TYPES[type]) return fail("Not found.", 404);
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ history: await listConsentHistory(client, crmContext(session, snapshot), TYPES[type], id) }));
}
