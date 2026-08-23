import {
  applyOfflineBatch,
  getOfflineChanges,
  getCrmOfflineReadiness,
  resolveStoredOfflineConflict,
} from "@vercentlabs/api";
import { requireMobileSession } from "@/core/mobile-session";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { readJson } from "@/core/http";
export async function GET(request: Request) {
  try {
    const s = await requireMobileSession(request);
    requirePermissionFromSession(s, PERMISSIONS.crmView);
    const c = await crmApiContext(s);
    const url = new URL(request.url);
    return mobileOk(
      request,
      await tenantTransaction(c.organizationId, (client) =>
        getOfflineChanges(client, c, {
          cursor: url.searchParams.get("cursor"),
          limit: url.searchParams.get("limit"),
        }),
      ),
    );
  } catch (e) {
    return mobileError(request, e);
  }
}
export async function POST(request: Request) {
  try {
    const s = await requireMobileSession(request);
    requirePermissionFromSession(s, PERMISSIONS.crmOpportunitiesManage);
    const c = await crmApiContext(s);
    const input = (await readJson(request)) as Record<string, unknown>;
    const action = String(input.action || "sync");
    const result = await tenantTransaction(c.organizationId, (client) =>
      action === "resolve-conflict"
        ? resolveStoredOfflineConflict(client, c, input)
        : action === "readiness"
          ? getCrmOfflineReadiness(
              client,
              c,
              String(input.commitSha || "local"),
            )
          : applyOfflineBatch(client, c, input),
    );
    return mobileOk(request, result);
  } catch (e) {
    return mobileError(request, e);
  }
}
