import { PermissionState } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { requireWorkspace } from "@/core/session";
import { LeadFormScreen } from "@/features/crm/leads/screens/LeadFormScreen";

export const metadata = { title: "New lead" };

export default async function NewLeadPage() {
  const session = await requireWorkspace();
  const canManage = session.roleSlugs.includes("organization_owner") || session.permissions.includes(CRM_PERMISSIONS.leadsManage);
  if (!canManage) {
    return <PermissionState title="You don't have access to create Leads" description="Ask an administrator to grant CRM lead management access." />;
  }
  return <LeadFormScreen mode="create" />;
}
