import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { requireWorkspace } from "@/core/session";
import { OpportunityFormScreen } from "@/features/crm/pipeline/opportunities/screens/OpportunityFormScreen";

export const metadata = { title: "New opportunity" };

export default async function NewOpportunityPage({ searchParams }: { searchParams: Promise<{ partyId?: string }> }) {
  const session = await requireWorkspace();
  const canManage =
    session.roleSlugs.includes("organization_owner") ||
    session.permissions.includes(CRM_PERMISSIONS.opportunitiesManage);
  const { partyId } = await searchParams;
  return <OpportunityFormScreen mode="create" canManage={canManage} initialPartyId={typeof partyId === "string" ? partyId : undefined} />;
}
