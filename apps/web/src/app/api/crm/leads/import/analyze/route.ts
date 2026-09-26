import { getDataExchangeDefinition, parseCsvUpload } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const IMPORT_PERMISSIONS = [CRM_PERMISSIONS.import, CRM_PERMISSIONS.leadsManage];

// F021 Lead import, step 0: the server parses the uploaded CSV (the browser
// never parses authoritatively) and returns the headers, a short sample and
// the row count so the user can map columns. Nothing is stored, so it is not
// billing-gated (see the billing mutation inventory).
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permissions: IMPORT_PERMISSIONS, action: "crm.leads.import.analyze" }, async () => {
    const form = await request.formData().catch(() => {
      throw new HttpError(400, "Upload a CSV file.");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Upload a CSV file.");
    const definition = getDataExchangeDefinition("crm.leads.import");
    const parsed = parseCsvUpload(Buffer.from(await file.arrayBuffer()), { maxRows: definition?.maximumRows });
    return ok({ fileName: file.name.slice(0, 240), headers: parsed.headers, sample: parsed.records.slice(0, 5), rowCount: parsed.rowCount });
  });
}
