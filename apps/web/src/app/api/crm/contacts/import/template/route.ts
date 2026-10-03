import { buildContactImportTemplate } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";
import { csvResponse } from "@/features/crm/contacts/server/contact-http";

// The downloadable import template: every importable column and one sample row.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsImport }, async () =>
    csvResponse(buildContactImportTemplate(), "contact-import-template.csv"),
  );
}
