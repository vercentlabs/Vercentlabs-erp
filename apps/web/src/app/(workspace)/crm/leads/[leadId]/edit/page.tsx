import { getCrmRecord } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { ErrorState, PermissionState } from "@vercentlabs/design-system";

import { withClient } from "@/core/db";
import { requireWorkspace } from "@/core/session";
import { crmContext } from "@/features/crm/shared/crm-context";
import { LeadFormScreen } from "@/features/crm/leads/screens/LeadFormScreen";
import type { Lead } from "@/features/crm/leads/types";

export const metadata = { title: "Edit lead" };

export default async function EditLeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const session = await requireWorkspace();
  const canManage = session.roleSlugs.includes("organization_owner") || session.permissions.includes(CRM_PERMISSIONS.leadsManage);
  if (!canManage) {
    return <PermissionState title="You don't have access to edit Leads" description="Ask an administrator to grant CRM lead management access." />;
  }
  const { leadId } = await params;
  let lead: Lead;
  try {
    lead = await withClient((client) => getCrmRecord(client, crmContext(session), "leads", leadId));
  } catch {
    return <ErrorState title="Lead not found" description="This Lead may have been merged, converted, or removed." />;
  }
  if (lead.recordStatus === "converted" || lead.recordStatus === "archived") {
    return <ErrorState title="This Lead can no longer be edited" description={`This Lead is ${lead.recordStatus} and is read-only.`} />;
  }
  return <LeadFormScreen mode="edit" lead={lead} />;
}
