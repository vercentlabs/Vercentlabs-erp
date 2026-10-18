import { requestCrmImportJob, type CrmDataJobEntity } from "@vercentlabs/api/crm";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readUpload } from "@/features/crm/leads/server/lead-http";

// Queues an import too large to run at once. Multipart fields: file, entity, mapping (JSON { header: field }), options (JSON: the same
// options the record's own import takes). The record's import permission is checked by the import itself, now and when it runs.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) => {
    const upload = await readUpload(request);
    let mapping: Record<string, string>;
    let options: Record<string, unknown>;
    try {
      mapping = JSON.parse(upload.field("mapping") || "{}");
      options = JSON.parse(upload.field("options") || "{}");
    } catch {
      throw new HttpError(400, "The column mapping is not valid.");
    }
    const job = await requestCrmImportJob(client, crmContext(session, snapshot), {
      entity: upload.field("entity") as CrmDataJobEntity, bytes: upload.bytes, fileName: upload.fileName, mapping, options,
    });
    return ok({ job }, 202);
  });
}
