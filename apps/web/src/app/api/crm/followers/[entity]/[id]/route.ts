import { listFollowers, setFollowing } from "@vercentlabs/api/crm";

import { fail, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// A record's followers (CRM plan 4.6): /api/crm/followers/{leads|opportunities|accounts|contacts}/{id}.
// GET lists them (its owner first) and whether you follow it; PUT { follow: true | false } follows or stops following it.
const TYPES: Record<string, "lead" | "opportunity" | "party" | "contact"> = { leads: "lead", opportunities: "opportunity", accounts: "party", contacts: "contact" };
type Params = { params: Promise<{ entity: string; id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { entity, id } = await params;
  if (!TYPES[entity]) return fail("Not found.", 404);
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok(await listFollowers(client, crmContext(session, snapshot), TYPES[entity], id)));
}

export async function PUT(request: Request, { params }: Params) {
  const { entity, id } = await params;
  if (!TYPES[entity]) return fail("Not found.", 404);
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => {
    const body = await readBody(request);
    return ok(await setFollowing(client, crmContext(session, snapshot), TYPES[entity], id, body.follow !== false));
  });
}
