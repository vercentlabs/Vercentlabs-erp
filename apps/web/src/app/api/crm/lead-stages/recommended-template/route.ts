import { z } from "zod";

import { applyLeadStageTemplateUpgrade, previewLeadStageTemplateUpgrade } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// "Apply recommended Vercentlabs 5-stage template" admin workflow (F007) —
// for an organization whose Lead stage catalogue has been customized (and
// therefore was never auto-upgraded by ensureDefaultLeadStages). GET
// previews exactly what would change; POST applies it and requires
// { confirm: true } in the body — this is a deliberate, reviewed action,
// not something a page load can trigger by accident.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage }, async ({ client, session }) => {
    const result = await previewLeadStageTemplateUpgrade(client, crmContext(session));
    return ok(result);
  });
}

const applyTemplateSchema = z.object({ confirm: z.literal(true) });

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session }) => {
    const input = applyTemplateSchema.parse(await readJson(request));
    const result = await applyLeadStageTemplateUpgrade(client, crmContext(session), input);
    return ok(result);
  });
}
