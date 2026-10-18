import { listRecordEmails, type CrmEmailRecordType } from "@vercentlabs/api/crm";

import { fail, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// The emails kept on a record, both ways, newest first.
const TYPES: Record<string, CrmEmailRecordType> = { leads: "lead", opportunities: "opportunity", accounts: "party", contacts: "contact" };

export async function GET(request: Request, { params }: { params: Promise<{ entity: string; id: string }> }) {
  const { entity, id } = await params;
  if (!TYPES[entity]) return fail("Not found.", 404);
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ emails: await listRecordEmails(client, crmContext(session, snapshot), TYPES[entity], id) }));
}
