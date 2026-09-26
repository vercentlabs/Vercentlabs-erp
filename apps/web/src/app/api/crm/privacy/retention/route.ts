import { getPrivacyRetentionDashboard } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// Retention policies (crm_privacy_retention_policies) plus the most recent
// crm_privacy_execution_runs — the CRM-specific retention dashboard,
// distinct from the platform-wide Privacy Administration screen at
// /settings/privacy (services/api/src/core/platform/privacy), which knows
// nothing about Leads/Contacts/Accounts specifically.
export async function GET() {
  try {
    const session = await requireWorkspace();
    const dashboard = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.privacyManage);
      return getPrivacyRetentionDashboard(client, crmContext(session));
    });
    return ok({ dashboard });
  } catch (error) {
    return errorResponse(error);
  }
}
