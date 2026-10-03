import { findDuplicateContacts } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/contacts/server/contact-http";

// Checks the person being typed against existing contacts.
// Body: { firstName, lastName, email, secondaryEmail, phone, mobile, alternatePhone, accountId, excludeId }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsView }, async ({ client, session }) => {
    const { excludeId, ...input } = await readBody(request);
    return ok(await findDuplicateContacts(client, crmContext(session), input, { excludeId: typeof excludeId === "string" ? excludeId : null }));
  });
}
