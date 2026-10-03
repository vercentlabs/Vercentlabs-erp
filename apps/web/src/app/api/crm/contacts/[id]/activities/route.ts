import { addContactActivity, listContactActivities } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type ContactRouteParams } from "@/features/crm/contacts/server/contact-http";

// Everything logged or scheduled with this person.
export async function GET(request: Request, route: ContactRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsView }, async ({ client, session }) =>
    ok({ activities: await listContactActivities(client, crmContext(session), (await route.params).id) }),
  );
}

// Body: { type, subject?, notes?, outcome?, occurredAt?, opportunityId?, nextAction? }
export async function POST(request: Request, route: ContactRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsEdit, billingWrite: true }, async ({ client, session }) =>
    ok(await addContactActivity(client, crmContext(session), (await route.params).id, await readBody(request)), 201),
  );
}
