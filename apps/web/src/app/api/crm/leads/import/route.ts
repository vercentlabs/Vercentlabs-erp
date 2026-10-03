import { importLeads } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readUpload } from "@/features/crm/leads/server/lead-http";

// Import step 2: create the leads. Multipart fields: file, mapping (JSON
// { header: field }), defaultSourceId?, defaultOwnerUserId?, skipDuplicates.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsImport, billingWrite: true }, async ({ client, session }) => {
    const context = crmContext(session);
    const upload = await readUpload(request);
    let mapping: Record<string, string>;
    try {
      mapping = JSON.parse(upload.field("mapping") || "{}");
    } catch {
      throw new HttpError(400, "The column mapping is not valid.");
    }
    const result = await importLeads(client, context, {
      bytes: upload.bytes,
      fileName: upload.fileName,
      mapping,
      defaultSourceId: upload.field("defaultSourceId") || null,
      defaultOwnerUserId: upload.field("defaultOwnerUserId") || null,
      skipDuplicates: upload.field("skipDuplicates") !== "false",
    });
    return ok({ result });
  });
}
