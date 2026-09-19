import { assertSameOriginOrMobile, capturePredictiveForecast } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F025 Stage A2 §11. capturePredictiveForecast (opportunity-revenue-
// intelligence.js) already existed, fully built, with zero frontend
// consumer — the dossier's "predictive confidence" requirement. A
// manager-triggered capture (mirroring F010's manual pipeline-snapshot
// pattern), never a background job — this returns its result directly
// so the caller sees it immediately, rather than requiring a separate
// "latest snapshot" read endpoint this pass doesn't otherwise need.
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = (await readJson(request).catch(() => ({}))) as { forecastPeriodId?: string };
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.opportunitiesManage, { mutation: true });
      return capturePredictiveForecast(client, crmContext(session), { forecastPeriodId: input.forecastPeriodId || null });
    });
    return ok(result, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
