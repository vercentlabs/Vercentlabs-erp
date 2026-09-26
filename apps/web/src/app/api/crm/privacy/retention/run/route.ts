import { runPrivacyRetention } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// Runs every active retention policy once, immediately (each policy
// normally runs on its own schedule via the worker) — an explicit "Run
// retention now" action for the settings screen. Batched with FOR UPDATE
// SKIP LOCKED internally so this is safe to trigger concurrently with a
// scheduled run.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.privacyManage, billingWrite: true }, async ({ client, session }) => {
    const input = (await readJson(request).catch(() => ({}))) as { limit?: number };
    const result = await runPrivacyRetention(client, crmContext(session), input);
    return ok(result);
  });
}
