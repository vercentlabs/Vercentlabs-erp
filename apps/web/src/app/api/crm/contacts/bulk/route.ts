import { bulkAssignContacts, bulkSetContactStatus } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/contacts/server/contact-http";

// Bulk operations on selected contacts. Body: { action, contactIds, ... }
//   assign  { ownerUserId?, teamId? }
//   status  { status: active | inactive | archived }
// Each contact succeeds or fails on its own; the response lists every outcome.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsView, billingWrite: true }, async ({ client, session }) => {
    const context = crmContext(session);
    const { action, ...input } = await readBody(request);
    const payload = input as { contactIds: string[] } & Record<string, unknown>;
    if (action === "assign") return ok(await bulkAssignContacts(client, context, payload));
    if (action === "status") return ok(await bulkSetContactStatus(client, context, payload as { contactIds: string[]; status: "active" | "inactive" | "archived" }));
    throw new HttpError(400, "Unknown bulk action.");
  });
}
