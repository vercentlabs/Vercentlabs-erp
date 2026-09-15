import { assertSameOriginOrMobile, createCrmLeadSource, listCrmLeadSources } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction, withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F004 Lead Sources — the dedicated governed module (lead-source-
// operations.js), not the generic /api/crm/[resource] boundary. That
// boundary already redirects "sources" create/update/archive to
// CRM_LEAD_SOURCE_API_MOVED (410) precisely so this richer module
// (default-source uniqueness, lead-count projection, sort order) stays
// the one real mutation path — verified by reading resource-mutation-
// service.js before building this, not assumed.
export async function GET() {
  try {
    const session = await requireWorkspace();
    const result = await withClient(async (client) => {
      await requireCrmAccess(client, session);
      return listCrmLeadSources(client, crmContext(session), { status: "all", limit: 200 });
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage);
      return createCrmLeadSource(client, crmContext(session), input);
    });
    return ok({ record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
