import { exportContacts } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { contactFiltersFromUrl, csvResponse } from "@/features/crm/contacts/server/contact-http";

// Downloads the contacts the list shows for the same view and filters.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsExport }, async ({ client, session }) => {
    const exported = await exportContacts(client, crmContext(session), contactFiltersFromUrl(new URL(request.url)));
    return csvResponse(exported.csv, exported.fileName);
  });
}
