import { getPrivacyRetentionDashboard } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// Retention policies (crm_privacy_retention_policies) plus the most recent
// crm_privacy_execution_runs — the CRM-specific retention dashboard,
// distinct from the platform-wide Privacy Administration screen at
// /settings/privacy (services/api/src/core/platform/privacy), which knows
// nothing about Leads/Contacts/Accounts specifically.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.privacyManage }, async ({ client, session }) => {
    const dashboard = await getPrivacyRetentionDashboard(client, crmContext(session));
    return ok({ dashboard });
  });
}
