import { assertSameOriginOrMobile, runPrivacyRetention } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// Runs every active retention policy once, immediately (each policy
// normally runs on its own schedule via the worker) — an explicit "Run
// retention now" action for the settings screen. Batched with FOR UPDATE
// SKIP LOCKED internally so this is safe to trigger concurrently with a
// scheduled run.
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = (await readJson(request).catch(() => ({}))) as { limit?: number };
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.privacyManage, { mutation: true });
      return runPrivacyRetention(client, crmContext(session), input);
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
