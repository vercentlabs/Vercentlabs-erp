import { checkWhatsAppConnection } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// Checks the saved WhatsApp Business number and token with Meta now.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage }, async ({ client, session, snapshot }) =>
    ok({ settings: await checkWhatsAppConnection(client, crmContext(session, snapshot)) }));
}
