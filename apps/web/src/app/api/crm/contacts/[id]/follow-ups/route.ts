import { scheduleContactFollowUp } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type ContactRouteParams } from "@/features/crm/contacts/server/contact-http";

// Body: { type: call | email | meeting | task | other, dueAt, assignedTo?, notes?, subject? }
export async function POST(request: Request, route: ContactRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsEdit, billingWrite: true }, async ({ client, session }) =>
    ok({ followUp: await scheduleContactFollowUp(client, crmContext(session), (await route.params).id, await readBody(request)) }, 201),
  );
}
