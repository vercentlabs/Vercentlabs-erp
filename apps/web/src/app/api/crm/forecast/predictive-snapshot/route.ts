import { capturePredictiveForecast } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F025 Stage A2 §11. capturePredictiveForecast (opportunity-revenue-
// intelligence.js) already existed, fully built, with zero frontend
// consumer — the dossier's "predictive confidence" requirement. A
// manager-triggered capture (mirroring F010's manual pipeline-snapshot
// pattern), never a background job — this returns its result directly
// so the caller sees it immediately, rather than requiring a separate
// "latest snapshot" read endpoint this pass doesn't otherwise need.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesManage, billingWrite: true }, async ({ client, session }) => {
    const input = (await readJson(request).catch(() => ({}))) as { forecastPeriodId?: string };
    const result = await capturePredictiveForecast(client, crmContext(session), { forecastPeriodId: input.forecastPeriodId || null });
    return ok(result, 201);
  });
}
