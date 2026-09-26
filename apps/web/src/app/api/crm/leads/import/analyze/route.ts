import { assertSameOriginOrMobile, getDataExchangeDefinition, parseCsvUpload } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F021 Lead import, step 0: the server parses the uploaded CSV (the browser
// never parses authoritatively) and returns the headers, a short sample and
// the row count so the user can map columns. Nothing is stored.
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const form = await request.formData().catch(() => {
      throw new HttpError(400, "Upload a CSV file.");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Upload a CSV file.");
    await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.import);
      await requireCrmAccess(client, session, CRM_PERMISSIONS.leadsManage);
      crmContext(session);
    });
    const definition = getDataExchangeDefinition("crm.leads.import");
    const parsed = parseCsvUpload(Buffer.from(await file.arrayBuffer()), { maxRows: definition?.maximumRows });
    return ok({ fileName: file.name.slice(0, 240), headers: parsed.headers, sample: parsed.records.slice(0, 5), rowCount: parsed.rowCount });
  } catch (error) {
    return errorResponse(error);
  }
}
