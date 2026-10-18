import { createCaptureForm, listCaptureForms } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// CRM › Setup › Web forms: the organization's lead-capture forms.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.captureManage }, async ({ client, session, snapshot }) =>
    ok({ forms: await listCaptureForms(client, crmContext(session, snapshot)) }));
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.captureManage, billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ form: await createCaptureForm(client, crmContext(session, snapshot), await readBody(request)) }, 201));
}
