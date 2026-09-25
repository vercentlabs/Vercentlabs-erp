import { assertSameOriginOrMobile, canUserAccessModule, listNotifications, markAllNotificationsRead, redactInaccessibleCrmNotifications } from "@vercentlabs/api";

import { tenantTransaction, withClient } from "@/core/db";
import { crmContext } from "@/features/crm/shared/crm-context";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";

export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const status =
      (url.searchParams.get("status") as "all" | "unread" | "read" | null) ||
      "all";
    // Stored notification text is history; what is SHOWN is re-checked
    // against the caller's current CRM access (targets they can no longer
    // open are redacted, never rewritten in the database).
    // Redacted items stay in the list (and in the unread count) as a neutral
    // "CRM record updated" stub, so the badge and the list always agree.
    // CRM availability uses the canonical module check (enabled, entitled,
    // released, permitted) — a disabled CRM redacts every CRM target.
    const notifications = await tenantTransaction(session.organizationId, async (client) =>
      redactInaccessibleCrmNotifications(client, crmContext(session), await listNotifications(client, session, { status }), {
        canUseCrm: await canUserAccessModule(client, session, "crm", process.env),
      }),
    );
    return ok({ notifications });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const result = await withClient((client) =>
      markAllNotificationsRead(client, session),
    );
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
