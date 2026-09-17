import { getCrmOptions } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// Dropdown/reference data (sources, sales stages, lost reasons, teams,
// territories, ...) for every CRM screen — one call, not a per-field
// browser-side fan-out.
export async function GET() {
  try {
    const session = await requireWorkspace();
    const options = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return getCrmOptions(client, crmContext(session));
    });
    return ok({ options });
  } catch (error) {
    return errorResponse(error);
  }
}
