import { captureForecastPeriodSnapshot } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// F025 manual snapshot. The client's idempotency key becomes the capture
// key, so a retried request never creates a second capture.
export async function POST(
  request: Request,
  context: { params: Promise<{ periodId: string }> },
) {
  return workspaceRoute(
    request,
    {
      module: "crm",
      permission: CRM_PERMISSIONS.forecastManage,
      billingWrite: true,
      action: "crm.forecast.snapshot",
    },
    async ({ client, session }) => {
      const { periodId } = await context.params;
      const input = (await readJson(request)) as { idempotencyKey?: string };
      const key = String(input.idempotencyKey ?? "").slice(0, 100);
      return ok(
        await captureForecastPeriodSnapshot(client, crmContext(session), {
          periodId,
          source: "manual",
          captureKey: key ? `manual:${key}` : null,
        }),
      );
    },
  );
}
