import { getWorkDefaults, saveWorkDefaults, workDefaultChoices } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// What a new task or follow-up starts with, and the choices the settings page offers.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.view }, async ({ client, session }) =>
    ok({ defaults: await getWorkDefaults(client, crmContext(session)), choices: workDefaultChoices() }),
  );
}

// Body: { taskPriority?, taskReminderMinutes?, followUpType?, followUpReminderMinutes? }
export async function PUT(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session }) =>
    ok({ defaults: await saveWorkDefaults(client, crmContext(session), await readBody(request)) }),
  );
}
