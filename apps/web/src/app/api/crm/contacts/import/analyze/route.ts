import { BACKGROUND_IMPORT_ROW_LIMIT, analyzeContactImport } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readUpload } from "@/features/crm/contacts/server/contact-http";

// Import step 1 (a file too large to import at once is read up to the background limit): read the file and suggest the column mapping.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsImport }, async ({ client, session, snapshot }) => {
    const upload = await readUpload(request);
    return ok({ analysis: await analyzeContactImport(client, crmContext(session, snapshot), { bytes: upload.bytes, fileName: upload.fileName, maxRows: BACKGROUND_IMPORT_ROW_LIMIT }) });
  });
}
