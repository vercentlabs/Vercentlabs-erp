import { getCrmOptions } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext } from "@/features/crm/shared/crm-context";

// Dropdown/reference data (sources, sales stages, lost reasons, teams,
// territories, ...) for every CRM screen — one call, not a per-field
// browser-side fan-out.
export async function GET() {
  try {
    const session = await requireWorkspace();
    const options = await withClient((client) => getCrmOptions(client, crmContext(session)));
    return ok({ options });
  } catch (error) {
    return errorResponse(error);
  }
}
