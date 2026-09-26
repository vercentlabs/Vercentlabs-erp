import { assertSameOriginOrMobile, getDataExchangeDefinition, parseCsvUpload, previewLeadImport } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F021 Lead import — stage 1 of 2 (preview -> commit). The uploaded file is
// parsed HERE (Shared Platform CSV parser: UTF-8, RFC 4180, header, row/column/
// field caps); previewLeadImport then validates every row against
// lead-acquisition.js's own field/consent rules and persists a
// crm_lead_import_batches/crm_lead_import_rows snapshot without creating any
// Lead. Same content + same mapping replays the same batch idempotently.
// Requires crm.import AND crm.leads.manage.
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
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
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.import);
      await requireCrmAccess(client, session, CRM_PERMISSIONS.leadsManage);
      return previewLeadImport(client, crmContext(session), {
        rows: parsed.records,
        fieldMapping,
        fileName: file.name.slice(0, 240),
        duplicateStrategy: String(form.get("duplicateStrategy") ?? "skip"),
      });
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
