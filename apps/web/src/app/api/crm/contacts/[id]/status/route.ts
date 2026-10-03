import { setContactStatus } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type ContactRouteParams } from "@/features/crm/contacts/server/contact-http";

// Deactivate, reactivate or archive. Body: { status, note? }
export async function POST(request: Request, route: ContactRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsArchive, billingWrite: true }, async ({ client, session }) => {
    const { status, note } = await readBody(request);
    if (status !== "active" && status !== "inactive" && status !== "archived") throw new HttpError(400, "Choose a status.");
    return ok(await setContactStatus(client, crmContext(session), (await route.params).id, status, { note: typeof note === "string" ? note : null }));
  });
}
