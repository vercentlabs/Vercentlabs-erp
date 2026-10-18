import { importOpportunities } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readUpload } from "@/features/crm/leads/server/lead-http";

// Deal import step 2: create the deals. Multipart fields: file, mapping (JSON { header: field }), createMissingCompanies,
// defaultOwnerUserId?.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesImport, billingWrite: true }, async ({ client, session, snapshot }) => {
    const upload = await readUpload(request);
    let mapping: Record<string, string>;
    try {
      mapping = JSON.parse(upload.field("mapping") || "{}");
    } catch {
      throw new HttpError(400, "The column mapping is not valid.");
    }
    const result = await importOpportunities(client, crmContext(session, snapshot), {
      bytes: upload.bytes,
      fileName: upload.fileName,
      mapping,
      createMissingCompanies: upload.field("createMissingCompanies") === "true",
      defaultOwnerUserId: upload.field("defaultOwnerUserId") || null,
    });
    return ok({ result });
  });
}
