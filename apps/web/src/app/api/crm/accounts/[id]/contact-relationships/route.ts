import { listAccountContactRelationships } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string }> };

// F003/F002 Stage A2 — the reverse view: which Contacts relate to this
// Account, with their role and primary flag. Same governed
// contact-relationships.js service, read-only here.
export async function GET(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { id } = await context.params;
    const rows = await listAccountContactRelationships(client, crmContext(session), id);
    return ok({ rows });
  });
}
