import { assertSameOriginOrMobile, previewLeadImport } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F021 Lead import — stage 1 of 2 (preview -> commit). previewLeadImport
// validates every row against lead-acquisition.js's own field/consent
// rules and persists a crm_lead_import_batches/crm_lead_import_rows
// snapshot, but creates no Lead yet; nothing is written to crm_leads
// until POST .../import/[batchId]/commit. Same content hash + same
// mapping replays the same batch idempotently (previewLeadImport's own
// content-hash check), so a duplicate preview submission is a no-op, not
// a second batch. previewLeadImport does not check a permission
// internally, so this route enforces crm.leads.manage (creating Leads
// via import is a variant of creating them manually).
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = (await readJson(request)) as Record<string, unknown>;
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.import);
      await requireCrmAccess(client, session, CRM_PERMISSIONS.leadsManage);
      return previewLeadImport(client, crmContext(session), input);
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
