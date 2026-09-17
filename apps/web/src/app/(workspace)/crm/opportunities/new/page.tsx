import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { requireWorkspace } from "@/core/session";
import { OpportunityFormScreen } from "@/features/crm/opportunities/screens/OpportunityFormScreen";

export const metadata = { title: "New opportunity" };

export default async function NewOpportunityPage() {
  const session = await requireWorkspace();
  const canManage = session.roleSlugs.includes("organization_owner") || session.permissions.includes(CRM_PERMISSIONS.opportunitiesManage);
  return <OpportunityFormScreen mode="create" canManage={canManage} />;
}
