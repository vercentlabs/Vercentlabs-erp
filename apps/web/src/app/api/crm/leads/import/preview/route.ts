import { getDataExchangeDefinition, parseCsvUpload, previewLeadImport } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// F021 Lead import — stage 1 of 2 (preview -> commit). The uploaded file is
// parsed HERE (Shared Platform CSV parser); previewLeadImport validates every
// row and stages a snapshot without creating any Lead (not billing-gated;
// the commit step is).
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permissions: [CRM_PERMISSIONS.import, CRM_PERMISSIONS.leadsManage], action: "crm.leads.import.preview" }, async ({ client, session }) => {
    const form = await request.formData().catch(() => {
      throw new HttpError(400, "Upload a CSV file.");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Upload a CSV file.");
    let fieldMapping: Record<string, string>;
    try {
      fieldMapping = JSON.parse(String(form.get("fieldMapping") ?? "{}"));
    } catch {
      throw new HttpError(400, "The column mapping is invalid.");
    }
    const definition = getDataExchangeDefinition("crm.leads.import");
    const parsed = parseCsvUpload(Buffer.from(await file.arrayBuffer()), { maxRows: definition?.maximumRows });
    const result = await previewLeadImport(client, crmContext(session), {
      rows: parsed.records,
      fieldMapping,
      fileName: file.name.slice(0, 240),
      duplicateStrategy: String(form.get("duplicateStrategy") ?? "skip"),
    });
    return ok(result);
  });
}
