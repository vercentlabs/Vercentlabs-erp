import { getForecastCalibration } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F025 Stage A2 §11. getForecastCalibration (opportunity-revenue-
// intelligence.js) already existed, fully tested
// (crm-forecast-calibration-integrity.test.mjs), with zero frontend
// consumer — the dossier's "accuracy/backtesting" requirement, wrongly
// marked as a genuine gap by an earlier audit that didn't find it.
// Compares each CLOSED period's predicted amount (from the real
// predictive-forecast snapshot, not a recalculation) against the
// period's actual won revenue.
export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const limit = url.searchParams.get("limit");
    const rows = await withClient(async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.opportunitiesManage);
      return getForecastCalibration(client, crmContext(session), limit ? Number(limit) : undefined);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}
