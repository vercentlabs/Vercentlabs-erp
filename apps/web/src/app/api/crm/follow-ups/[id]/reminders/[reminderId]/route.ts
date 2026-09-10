import { acknowledgeReminder } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/api";

// A single reminder-receipt action (acknowledge) rather than a full CRUD
// surface — reminders are generated/cancelled by the parent Follow-up's own
// lifecycle (see follow-up-operations.js), never edited directly.
export async function PATCH(request: Request, route: { params: Promise<{ id: string; reminderId: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const { id, reminderId } = await route.params;
    assertCrmIdentifier(id);
    assertCrmIdentifier(reminderId);
    const input = (await readJson(request)) as Record<string, unknown>;
    if (input.action !== "acknowledge") throw new HttpError(400, "Unsupported reminder action.");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, (client) => acknowledgeReminder(client, context, id, reminderId));
    return ok({ message: "Reminder acknowledged.", record });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
