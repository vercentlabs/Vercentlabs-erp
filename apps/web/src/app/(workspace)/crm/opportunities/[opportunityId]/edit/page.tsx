import { getCrmRecord } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { requireWorkspace } from "@/core/session";
import { crmContext, loadRecordForEdit } from "@/features/crm/shared/crm-context";
import { OpportunityFormScreen } from "@/features/crm/opportunities/screens/OpportunityFormScreen";
import type { Opportunity } from "@/features/crm/opportunities/types";

export const metadata = { title: "Edit opportunity" };

export default async function EditOpportunityPage({ params }: { params: Promise<{ opportunityId: string }> }) {
  const session = await requireWorkspace();
  const canManage = session.roleSlugs.includes("organization_owner") || session.permissions.includes(CRM_PERMISSIONS.opportunitiesManage);
  const { opportunityId } = await params;
  const loaded = canManage ? await loadRecordForEdit(session, (client) => getCrmRecord(client, crmContext(session), "opportunities", opportunityId)) : { record: null, notFound: false };
  const opportunity = loaded.record as Opportunity | null;
  const notFound = loaded.notFound;
  return <OpportunityFormScreen mode="edit" opportunity={opportunity ?? undefined} canManage={canManage} notFound={notFound} />;
}
