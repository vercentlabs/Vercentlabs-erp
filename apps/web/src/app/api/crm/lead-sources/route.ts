import { createCrmLeadSource, listCrmLeadSources } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// F004 Lead Sources — the dedicated governed module (lead-source-
// operations.js), not the generic /api/crm/[resource] boundary. That
// boundary already redirects "sources" create/update/archive to
// CRM_LEAD_SOURCE_API_MOVED (410) precisely so this richer module
// (default-source uniqueness, lead-count projection, sort order) stays
// the one real mutation path.
//
// Reference adoption of the Shared Access route composition for a business
// module: tenant-RLS transaction, CRM module access (released/enabled/
// entitled/crm.view) from the request's WorkspaceAccessSnapshot, the
// settings permission and the billing write gate for the mutation.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", action: "crm.lead_source.list" }, async ({ client, session }) =>
    ok(await listCrmLeadSources(client, crmContext(session), { status: "all", limit: 200 })),
  );
}

export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true, action: "crm.lead_source.create" },
    async ({ client, session }) => {
      const input = (await readJson(request)) as Record<string, unknown>;
      return ok({ record: await createCrmLeadSource(client, crmContext(session), input) }, 201);
    },
  );
}
