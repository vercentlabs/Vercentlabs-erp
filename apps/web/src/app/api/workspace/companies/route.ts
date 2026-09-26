import { listAccessibleCompanies } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// The companies (and branches) the caller may switch to — the same predicate
// session resolution uses.
export async function GET(request: Request) {
  return workspaceRoute(request, { action: "workspace.companies.list" }, async ({ client, session }) =>
    ok({ companies: await listAccessibleCompanies(client, session.organizationId, session.userId) }),
  );
}
