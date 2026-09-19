import { z } from "zod";

import { applyLeadStageTemplateUpgrade, assertSameOriginOrMobile, previewLeadStageTemplateUpgrade } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// "Apply recommended Vercentlabs 5-stage template" admin workflow (F007) —
// for an organization whose Lead stage catalogue has been customized (and
// therefore was never auto-upgraded by ensureDefaultLeadStages). GET
// previews exactly what would change; POST applies it and requires
// { confirm: true } in the body — this is a deliberate, reviewed action,
// not something a page load can trigger by accident.
export async function GET() {
  try {
    const session = await requireWorkspace();
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage);
      return previewLeadStageTemplateUpgrade(client, crmContext(session));
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}

const applyTemplateSchema = z.object({ confirm: z.literal(true) });

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = applyTemplateSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage, { mutation: true });
      return applyLeadStageTemplateUpgrade(client, crmContext(session), input);
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
