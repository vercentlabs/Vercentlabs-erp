import { getForecastCalibration } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F025 forecast accuracy/backtesting. getForecastCalibration (opportunity-
// revenue-intelligence.js; see crm-forecast-calibration-integrity.test.mjs).
// Compares each CLOSED period's predicted amount (from the real
// predictive-forecast snapshot, not a recalculation) against the
// period's actual won revenue.
// Organisation-wide figures (every won deal, every open deal): forecast
// governors only (crm.forecast.manage), not every seller.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { module: "crm", permission: CRM_PERMISSIONS.forecastManage },
    async ({ client, session }) => {
      const url = new URL(request.url);
      const limit = url.searchParams.get("limit");
      const rows = await getForecastCalibration(
        client,
        crmContext(session),
        limit ? Number(limit) : undefined,
      );
      return ok({ rows });
    },
  );
}
